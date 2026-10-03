"use client";

import * as React from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BellRing,
  CalendarDays,
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  LogIn,
  LogOut,
  MailCheck,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { ApiError, get, post } from "@/lib/api";

type CustomerAccount = {
  id: string;
  customerId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  newsletterOptIn: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  verificationChannel: "email" | "sms";
  lastLoginAt: string | null;
};

type AccountResponse = { account: CustomerAccount };
type CustomerActivity = {
  id: string;
  title: string;
  summary: string;
  body: string | null;
  imageUrl: string | null;
  buttonLabel: string | null;
  buttonUrl: string | null;
  publishedAt: string | null;
};
type ActivitiesResponse = { activities: CustomerActivity[] };
type VerificationResponse = {
  verification: { channel: "email" | "sms"; destination: string; sent: boolean } | null;
  message: string;
};
type VerificationState = {
  identifier: string;
  channel: "email" | "sms";
  destination: string;
};
type View = "login" | "register" | "verify" | "forgot" | "reset" | "profile";

function messageFor(error: unknown): string {
  if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
    return "Vérifiez les champs signalés ci-dessous.";
  }
  if (error instanceof ApiError) return error.message;
  return "Une erreur est survenue. Réessayez dans un instant.";
}

function Field({
  label,
  children,
  error,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
}) {
  return (
    <label className={`grid gap-2 text-sm font-semibold ${error ? "text-red-800" : "text-slate-700"}`}>
      {label}
      {children}
      {error ? <span className="text-xs font-semibold leading-5 text-red-700">{error}</span> : null}
    </label>
  );
}

const inputClass =
  "min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[15px] text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100";

function inputClassFor(error?: string): string {
  return error
    ? `${inputClass} border-red-400 bg-red-50 focus:border-red-600 focus:ring-red-100`
    : inputClass;
}

export function PublicCustomerAccount({
  domain,
  homeHref = "/",
}: {
  domain: string;
  homeHref?: string;
}) {
  const endpoint = `/public/websites/domains/${encodeURIComponent(domain)}/account`;
  const [account, setAccount] = React.useState<CustomerAccount | null>(null);
  const [view, setView] = React.useState<View>("login");
  const [checking, setChecking] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [email, setEmail] = React.useState("");
  const [loginIdentifier, setLoginIdentifier] = React.useState("");
  const [loginPassword, setLoginPassword] = React.useState("");
  const [confirmationCode, setConfirmationCode] = React.useState("");
  const [verification, setVerification] = React.useState<VerificationState | null>(null);
  const [register, setRegister] = React.useState({
    fullName: "",
    email: "",
    phone: "",
    password: "",
    verificationChannel: "sms" as "email" | "sms",
    newsletterOptIn: false,
  });
  const [resetToken, setResetToken] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [activities, setActivities] = React.useState<CustomerActivity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = React.useState(false);

  function storeFieldErrors(error: unknown) {
    setFieldErrors(error instanceof ApiError ? error.fieldErrors : {});
  }

  const loadActivities = React.useCallback(async () => {
    setActivitiesLoading(true);
    try {
      const result = await get<ActivitiesResponse>(`${endpoint}/activities`);
      setActivities(result.activities);
    } finally {
      setActivitiesLoading(false);
    }
  }, [endpoint]);

  const hydrate = React.useCallback(async () => {
    const result = await get<AccountResponse>(`${endpoint}/me`);
    setAccount(result.account);
    setView("profile");
    await loadActivities();
  }, [endpoint, loadActivities]);

  React.useEffect(() => {
    let active = true;
    const start = async () => {
      const query = new URLSearchParams(window.location.search);
      const verificationToken = query.get("verify");
      const recoveryToken = query.get("reset");
      try {
        if (verificationToken) {
          const result = await post<AccountResponse>(`${endpoint}/verify-email`, {
            token: verificationToken,
          });
          if (!active) return;
          setLoginIdentifier(result.account.email ?? result.account.phone ?? "");
          setView("login");
          setNotice({ kind: "success", text: "Votre contact est confirmé. Connectez-vous pour accéder à votre espace." });
          window.history.replaceState({}, "", "/account");
          return;
        }
        if (recoveryToken) {
          if (!active) return;
          setResetToken(recoveryToken);
          setView("reset");
          return;
        }
        await hydrate();
      } catch (error) {
        if (!active) return;
        const apiError = error instanceof ApiError ? error : null;
        if (apiError?.status && apiError.status !== 401 && apiError.status !== 403) {
          setNotice({ kind: "error", text: messageFor(error) });
        }
      } finally {
        if (active) setChecking(false);
      }
    };
    void start();
    return () => {
      active = false;
    };
  }, [endpoint, hydrate]);

  async function submitLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    setFieldErrors({});
    try {
      const result = await post<AccountResponse>(`${endpoint}/login`, {
        identifier: loginIdentifier,
        password: loginPassword,
      });
      setAccount(result.account);
      setLoginPassword("");
      setView("profile");
      await loadActivities();
    } catch (error) {
      storeFieldErrors(error);
      const reason = error instanceof ApiError && typeof error.details === "object" && error.details !== null && "reason" in error.details
        ? (error.details as { reason?: string }).reason
        : null;
      if (reason === "contact_not_verified") {
        setVerification({ identifier: loginIdentifier, channel: "sms", destination: loginIdentifier });
        setConfirmationCode("");
        setView("verify");
        setNotice({ kind: "success", text: "Votre compte doit être confirmé. Choisissez le canal puis demandez un code." });
      } else {
        setNotice({ kind: "error", text: messageFor(error) });
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitRegistration(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    setFieldErrors({});
    try {
      const result = await post<VerificationResponse>(`${endpoint}/register`, register);
      const identifier = register.verificationChannel === "sms" ? register.phone : register.email;
      setEmail(register.email);
      setLoginIdentifier(identifier);
      setVerification({
        identifier,
        channel: result.verification?.channel ?? register.verificationChannel,
        destination: result.verification?.destination ?? identifier,
      });
      setConfirmationCode("");
      setRegister({ fullName: "", email: "", phone: "", password: "", verificationChannel: "sms", newsletterOptIn: false });
      setView("verify");
      setNotice({ kind: result.verification?.sent === false ? "error" : "success", text: result.verification?.sent === false ? "Le code n’a pas pu être livré. Vérifiez votre contact ou choisissez l’autre canal." : "Votre code de confirmation a été envoyé. Saisissez-le pour activer votre compte." });
    } catch (error) {
      storeFieldErrors(error);
      setNotice({ kind: "error", text: messageFor(error) });
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification(channel = verification?.channel ?? "sms") {
    const identifier = verification?.identifier || loginIdentifier.trim();
    if (!identifier) {
      setNotice({ kind: "error", text: "Saisissez d’abord votre e-mail ou votre numéro de téléphone." });
      return;
    }
    setBusy(true);
    setFieldErrors({});
    try {
      const result = await post<VerificationResponse>(`${endpoint}/resend-verification`, { identifier, channel });
      if (result.verification) {
        setVerification({ identifier, channel: result.verification.channel, destination: result.verification.destination });
      }
      setNotice({ kind: result.verification?.sent === false ? "error" : "success", text: result.verification?.sent === false ? "Le code n’a pas pu être livré. Vérifiez votre contact ou choisissez l’autre canal." : "Si votre compte doit être confirmé, un nouveau code vient d’être envoyé." });
    } catch (error) {
      storeFieldErrors(error);
      setNotice({ kind: "error", text: messageFor(error) });
    } finally {
      setBusy(false);
    }
  }

  async function submitVerification(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!verification) return;
    setBusy(true);
    setNotice(null);
    setFieldErrors({});
    try {
      const result = await post<AccountResponse>(`${endpoint}/verify-code`, {
        identifier: verification.identifier,
        channel: verification.channel,
        code: confirmationCode,
      });
      setLoginIdentifier(result.account.email ?? result.account.phone ?? verification.identifier);
      setConfirmationCode("");
      setVerification(null);
      setView("login");
      setNotice({ kind: "success", text: "Votre contact est confirmé. Connectez-vous avec votre mot de passe." });
    } catch (error) {
      storeFieldErrors(error);
      setNotice({ kind: "error", text: messageFor(error) });
    } finally {
      setBusy(false);
    }
  }

  async function requestReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    setFieldErrors({});
    try {
      await post(`${endpoint}/forgot-password`, { email });
      setNotice({ kind: "success", text: "Si cette adresse correspond à un compte client, un lien sécurisé vient d’être envoyé." });
    } catch (error) {
      storeFieldErrors(error);
      setNotice({ kind: "error", text: messageFor(error) });
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    setFieldErrors({});
    try {
      await post(`${endpoint}/reset-password`, { token: resetToken, password: newPassword });
      setNewPassword("");
      setResetToken("");
      window.history.replaceState({}, "", "/account");
      setView("login");
      setNotice({ kind: "success", text: "Mot de passe mis à jour. Vous pouvez vous connecter." });
    } catch (error) {
      storeFieldErrors(error);
      setNotice({ kind: "error", text: messageFor(error) });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await post(`${endpoint}/logout`);
    } catch {
      // The browser must still leave the public account screen if its old
      // session was already revoked on the server.
    } finally {
      setAccount(null);
      setActivities([]);
      setView("login");
      setBusy(false);
    }
  }

  const buttonClass =
    "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-800 px-5 text-sm font-bold text-white shadow-[0_18px_30px_-18px_rgba(6,78,59,.75)] transition hover:-translate-y-0.5 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <main className="min-h-screen bg-[#f5f7f3] px-4 py-5 text-slate-950 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-5xl">
        <a href={homeHref} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 transition hover:text-emerald-800">
          <ArrowLeft className="size-4" /> Retour au site Congo Omega
        </a>
        <section className="mt-5 overflow-hidden rounded-[2rem] border border-emerald-950/10 bg-white shadow-[0_36px_85px_-50px_rgba(15,23,42,.75)]">
          <div className="relative overflow-hidden bg-slate-950 px-6 py-8 text-white sm:px-10 sm:py-10">
            <div className="absolute -right-20 -top-24 size-72 rounded-full border border-emerald-100/15" />
            <div className="absolute right-12 top-8 size-40 rounded-full bg-emerald-400/10 blur-2xl" />
            <div className="relative flex flex-wrap items-start justify-between gap-5">
              <div>
                <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[.17em] text-amber-200"><Sparkles className="size-3.5" /> Congo Omega</p>
                <h1 className="mt-3 text-3xl font-semibold tracking-[-.045em] sm:text-4xl">Mon compte Congo Omega</h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-white/70">Découvrez les actualités, initiatives et activités partagées par Congo Omega dans un espace personnel et sécurisé.</p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-2 text-xs font-semibold text-emerald-50"><ShieldCheck className="size-4 text-emerald-200" /> Espace personnel sécurisé</span>
            </div>
          </div>
          <div className="grid lg:grid-cols-[.8fr_1.2fr]">
            <aside className="border-b border-slate-100 bg-[#eef5ef] px-5 py-4 sm:p-9 lg:border-b-0 lg:border-r">
              <div className="flex items-center gap-3 sm:hidden">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-emerald-800 shadow-sm"><BellRing className="size-4" /></span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">Actualités Congo Omega</p>
                  <p className="mt-0.5 text-xs leading-4 text-slate-600">Espace public, séparé des candidatures et de LiteHubs.</p>
                </div>
              </div>
              <div className="hidden sm:block">
                <p className="text-xs font-bold uppercase tracking-[.15em] text-emerald-800">Votre espace d’activités</p>
                <div className="mt-6 grid gap-4">
                  <div className="rounded-2xl border border-white bg-white/80 p-4"><BellRing className="size-5 text-emerald-800" /><p className="mt-3 font-semibold">Actualités choisies</p><p className="mt-1 text-sm leading-5 text-slate-600">Consultez les activités, initiatives et informations que Congo Omega partage avec vous.</p></div>
                  <div className="rounded-2xl border border-white bg-white/80 p-4"><ShieldCheck className="size-5 text-emerald-800" /><p className="mt-3 font-semibold">Accès personnel séparé</p><p className="mt-1 text-sm leading-5 text-slate-600">Cet espace ne donne jamais accès aux candidatures, aux dossiers de recrutement ni à LiteHubs.</p></div>
                </div>
              </div>
            </aside>
            <section className="p-6 sm:p-9">
              {notice ? <div className={`mb-6 flex gap-3 rounded-xl border p-4 text-sm leading-6 ${notice.kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-red-200 bg-red-50 text-red-900"}`}><CheckCircle2 className="mt-0.5 size-4 shrink-0" />{notice.text}</div> : null}
              {checking ? <div className="flex min-h-72 items-center justify-center gap-3 text-sm font-semibold text-slate-500"><LoaderCircle className="size-5 animate-spin" /> Vérification de votre session…</div> : null}
              {!checking && view === "login" ? <form noValidate className="grid gap-5" onSubmit={submitLogin}><div><p className="text-xs font-bold uppercase tracking-[.15em] text-emerald-800">Connexion</p><h2 className="mt-2 text-2xl font-semibold tracking-[-.035em]">Bon retour.</h2><p className="mt-2 text-sm leading-6 text-slate-600">Utilisez l’adresse e-mail ou le numéro de téléphone associé à votre compte Congo Omega.</p></div><Field label="E-mail ou numéro de téléphone" error={fieldErrors.identifier?.[0]}><input className={inputClassFor(fieldErrors.identifier?.[0])} autoComplete="username" value={loginIdentifier} onChange={(event) => setLoginIdentifier(event.target.value)} required /></Field><Field label="Mot de passe" error={fieldErrors.password?.[0]}><input className={inputClassFor(fieldErrors.password?.[0])} type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} required /></Field><button disabled={busy} className={buttonClass} type="submit">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <LogIn className="size-4" />} Se connecter</button><div className="flex flex-wrap gap-x-5 gap-y-3 text-sm font-semibold text-emerald-800"><button type="button" onClick={() => { setNotice(null); setFieldErrors({}); setView("register"); }}>Créer un compte</button><button type="button" onClick={() => { setNotice(null); setFieldErrors({}); setView("forgot"); }}>Mot de passe oublié ?</button></div></form> : null}
              {!checking && view === "register" ? <form noValidate className="grid gap-5" onSubmit={submitRegistration}><div><p className="text-xs font-bold uppercase tracking-[.15em] text-emerald-800">Nouveau compte</p><h2 className="mt-2 text-2xl font-semibold tracking-[-.035em]">Créez votre espace client.</h2><p className="mt-2 text-sm leading-6 text-slate-600">Nous confirmons votre contact avec un code à six chiffres avant toute connexion.</p></div><Field label="Nom complet" error={fieldErrors.fullName?.[0]}><input className={inputClassFor(fieldErrors.fullName?.[0])} value={register.fullName} autoComplete="name" onChange={(event) => setRegister({ ...register, fullName: event.target.value })} required /></Field><div className="grid gap-5 sm:grid-cols-2"><Field label={`Adresse e-mail${register.verificationChannel === "email" ? "" : " (facultatif)"}`} error={fieldErrors.email?.[0]}><input className={inputClassFor(fieldErrors.email?.[0])} type="email" autoComplete="email" value={register.email} onChange={(event) => setRegister({ ...register, email: event.target.value })} required={register.verificationChannel === "email"} /></Field><Field label={`Téléphone${register.verificationChannel === "sms" ? "" : " (facultatif)"}`} error={fieldErrors.phone?.[0]}><input className={inputClassFor(fieldErrors.phone?.[0])} type="tel" autoComplete="tel" placeholder="+243…" value={register.phone} onChange={(event) => setRegister({ ...register, phone: event.target.value })} required={register.verificationChannel === "sms"} /></Field></div><Field label="Recevoir mon code de confirmation"><select className={inputClassFor(fieldErrors.verificationChannel?.[0])} value={register.verificationChannel} onChange={(event) => setRegister({ ...register, verificationChannel: event.target.value as "email" | "sms" })}><option value="sms">Par SMS (recommandé)</option><option value="email">Par e-mail</option></select></Field><Field label="Mot de passe" error={fieldErrors.password?.[0]}><input className={inputClassFor(fieldErrors.password?.[0])} type="password" autoComplete="new-password" minLength={10} value={register.password} onChange={(event) => setRegister({ ...register, password: event.target.value })} required /><span className="text-xs font-medium text-slate-500">10 caractères minimum, avec majuscule, minuscule et chiffre.</span></Field><label className="flex items-start gap-3 rounded-xl bg-slate-50 p-4 text-sm leading-5 text-slate-700"><input className="mt-0.5 size-4 accent-emerald-800" type="checkbox" checked={register.newsletterOptIn} onChange={(event) => setRegister({ ...register, newsletterOptIn: event.target.checked })} /> Je souhaite recevoir les nouvelles et offres de Congo Omega. Je peux arrêter à tout moment.</label><button disabled={busy} className={buttonClass} type="submit">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <UserRound className="size-4" />} Créer mon compte et recevoir le code</button><button className="text-sm font-semibold text-emerald-800" type="button" onClick={() => setView("login")}>J’ai déjà un compte</button></form> : null}
              {!checking && view === "verify" ? <form noValidate className="grid gap-5" onSubmit={submitVerification}><div><p className="text-xs font-bold uppercase tracking-[.15em] text-emerald-800">Confirmation</p><h2 className="mt-2 text-2xl font-semibold tracking-[-.035em]">Saisissez votre code.</h2><p className="mt-2 text-sm leading-6 text-slate-600">Entrez le code à six chiffres envoyé à <strong>{verification?.destination || "votre contact"}</strong>. Il expire après 10 minutes.</p></div><Field label="Mode de réception"><select className={inputClass} value={verification?.channel ?? "sms"} disabled={busy} onChange={(event) => void resendVerification(event.target.value as "email" | "sms")}><option value="sms">Par SMS</option><option value="email">Par e-mail</option></select></Field><Field label="Code de confirmation" error={fieldErrors.code?.[0]}><input className={`${inputClassFor(fieldErrors.code?.[0])} text-center text-xl font-bold tracking-[.35em]`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={confirmationCode} onChange={(event) => setConfirmationCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required /></Field><button disabled={busy || confirmationCode.length !== 6 || !verification} className={buttonClass} type="submit">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Confirmer mon compte</button><div className="flex flex-wrap gap-x-5 gap-y-3 text-sm font-semibold text-emerald-800"><button type="button" disabled={busy} onClick={() => void resendVerification()}>Renvoyer un code</button><button type="button" onClick={() => { setNotice(null); setFieldErrors({}); setView("login"); }}>Retour à la connexion</button></div></form> : null}
              {!checking && view === "forgot" ? <form className="grid gap-5" onSubmit={requestReset}><div><p className="text-xs font-bold uppercase tracking-[.15em] text-emerald-800">Accès</p><h2 className="mt-2 text-2xl font-semibold tracking-[-.035em]">Réinitialiser le mot de passe.</h2><p className="mt-2 text-sm leading-6 text-slate-600">Nous vous enverrons un lien sécurisé si cet e-mail correspond à un compte client.</p></div><Field label="E-mail"><input className={inputClass} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></Field><button disabled={busy} className={buttonClass} type="submit">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <MailCheck className="size-4" />} Envoyer le lien</button><button className="text-sm font-semibold text-emerald-800" type="button" onClick={() => setView("login")}>Retour à la connexion</button></form> : null}
              {!checking && view === "reset" ? <form className="grid gap-5" onSubmit={submitReset}><div><p className="text-xs font-bold uppercase tracking-[.15em] text-emerald-800">Nouveau mot de passe</p><h2 className="mt-2 text-2xl font-semibold tracking-[-.035em]">Choisissez un mot de passe solide.</h2></div><Field label="Nouveau mot de passe"><input className={inputClass} type="password" autoComplete="new-password" minLength={10} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></Field><button disabled={busy} className={buttonClass} type="submit">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />} Enregistrer le mot de passe</button></form> : null}
              {!checking && view === "profile" && account ? (
                <div className="space-y-7">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[.15em] text-emerald-800">Vos activités Congo Omega</p>
                      <h2 className="mt-2 text-2xl font-semibold tracking-[-.035em]">Bonjour {account.fullName.split(" ")[0]}.</h2>
                      <p className="mt-2 text-sm text-slate-600">{account.email ?? account.phone} · {account.emailVerified ? "e-mail vérifié" : "numéro vérifié"}</p>
                    </div>
                    <button type="button" disabled={busy} onClick={() => void logout()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"><LogOut className="size-4" /> Se déconnecter</button>
                  </div>
                  <div className="border-t border-slate-100 pt-6">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <h3 className="text-xl font-semibold tracking-[-.025em] text-slate-950">À découvrir</h3>
                        <p className="mt-1 text-sm leading-6 text-slate-600">Les nouvelles et initiatives préparées pour vous par Congo Omega.</p>
                      </div>
                      <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-900"><Sparkles className="size-3.5" /> Contenu partagé</span>
                    </div>
                    {activitiesLoading ? (
                      <div className="mt-6 grid gap-4 sm:grid-cols-2">
                        {[0, 1].map((index) => <div key={index} className="h-64 animate-pulse rounded-2xl bg-slate-100" />)}
                      </div>
                    ) : activities.length ? (
                      <div className="mt-6 grid gap-5 sm:grid-cols-2">
                        {activities.map((activity) => (
                          <article key={activity.id} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_36px_-30px_rgba(15,23,42,.72)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_24px_42px_-28px_rgba(6,78,59,.4)]">
                            {activity.imageUrl ? <img src={activity.imageUrl} alt="" className="aspect-[16/9] w-full bg-emerald-50 object-cover" /> : <div className="relative aspect-[16/9] overflow-hidden bg-[radial-gradient(circle_at_18%_20%,rgba(251,191,36,.7),transparent_28%),linear-gradient(130deg,#064e3b,#0f766e_56%,#5eead4)]"><div className="absolute -right-8 -top-6 size-32 rounded-full border-[18px] border-white/15" /><Sparkles className="absolute bottom-6 left-6 size-8 text-amber-100" /></div>}
                            <div className="p-5">
                              <p className="flex items-center gap-2 text-xs font-semibold text-emerald-800"><CalendarDays className="size-3.5" /> {activity.publishedAt ? new Intl.DateTimeFormat("fr-CD", { day: "numeric", month: "long", year: "numeric" }).format(new Date(activity.publishedAt)) : "Nouvelle activité"}</p>
                              <h4 className="mt-3 text-lg font-semibold tracking-[-.02em] text-slate-950">{activity.title}</h4>
                              <p className="mt-2 text-sm leading-6 text-slate-600">{activity.summary}</p>
                              {activity.body ? <p className="mt-3 text-sm leading-6 text-slate-600">{activity.body}</p> : null}
                              {activity.buttonUrl ? <a href={activity.buttonUrl} target={activity.buttonUrl.startsWith("http") ? "_blank" : undefined} rel={activity.buttonUrl.startsWith("http") ? "noreferrer" : undefined} className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-emerald-800 transition hover:gap-3 hover:text-emerald-700">{activity.buttonLabel || "En savoir plus"}<ArrowUpRight className="size-4" /></a> : null}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-6 rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/60 p-6 text-center"><BellRing className="mx-auto size-6 text-emerald-700" /><p className="mt-3 font-semibold text-emerald-950">Aucune activité pour le moment</p><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-emerald-900/75">Lorsque Congo Omega partagera une nouvelle activité avec vous, elle apparaîtra ici.</p></div>
                    )}
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
