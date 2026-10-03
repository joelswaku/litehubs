import { z } from "zod";
import { isValidPhone, normalizePhone } from "../../utils/phone";

const publicCustomerPasswordSchema = z
  .string()
  .min(10, "Le mot de passe doit contenir au moins 10 caractères")
  .max(128, "Le mot de passe ne peut pas dépasser 128 caractères")
  .refine((value) => /[a-z]/.test(value), "Le mot de passe doit contenir une minuscule")
  .refine((value) => /[A-Z]/.test(value), "Le mot de passe doit contenir une majuscule")
  .refine((value) => /[0-9]/.test(value), "Le mot de passe doit contenir un chiffre");

export const publicWebsiteDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
    "Saisissez un domaine, par exemple entreprise.com",
  );

export const publicWebsiteDomainParams = z.object({
  domain: publicWebsiteDomainSchema,
});

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(255)
  .email("Saisissez une adresse e-mail valide");

const optionalEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(255)
  .transform((value) => (value ? value : null))
  .refine((value) => value === null || z.string().email().safeParse(value).success, {
    message: "Saisissez une adresse e-mail valide",
  });

const optionalPhoneSchema = z
  .string()
  .trim()
  .max(80)
  .optional()
  .transform((value) => (value ? normalizePhone(value) : null))
  .refine((value) => value === null || isValidPhone(value), {
    message: "Saisissez un numéro de téléphone valide, avec l’indicatif du pays si nécessaire",
  });

const publicNameSchema = z
  .string()
  .trim()
  .min(2, "Saisissez votre nom complet")
  .max(150);

export const publicCustomerRegisterSchema = z
  .object({
    fullName: publicNameSchema,
    email: optionalEmailSchema,
    phone: optionalPhoneSchema,
    password: publicCustomerPasswordSchema,
    verificationChannel: z.enum(["email", "sms"]),
    newsletterOptIn: z.boolean().default(false),
  })
  .superRefine((value, context) => {
    if (!value.email && !value.phone) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["email"],
        message: "Saisissez un e-mail ou un numéro de téléphone",
      });
    }
    if (value.verificationChannel === "email" && !value.email) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["email"],
        message: "Un e-mail est requis pour recevoir le code par e-mail",
      });
    }
    if (value.verificationChannel === "sms" && !value.phone) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["phone"],
        message: "Un numéro de téléphone est requis pour recevoir le code par SMS",
      });
    }
  })
  .strict();

export const publicCustomerLoginSchema = z
  .object({
    identifier: z
      .string()
      .trim()
      .min(3, "Saisissez votre e-mail ou votre numéro de téléphone")
      .max(255),
    password: z.string().min(1, "Le mot de passe est requis").max(128),
  })
  .strict();

export const publicCustomerEmailSchema = z
  .object({ email: emailSchema })
  .strict();

export const publicCustomerTokenSchema = z
  .object({ token: z.string().min(20, "Le lien sécurisé est invalide") })
  .strict();

export const publicCustomerVerificationCodeSchema = z
  .object({
    identifier: z.string().trim().min(3).max(255),
    channel: z.enum(["email", "sms"]),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Saisissez les 6 chiffres du code"),
  })
  .strict();

export const publicCustomerResendVerificationSchema = z
  .object({
    identifier: z.string().trim().min(3).max(255),
    channel: z.enum(["email", "sms"]),
  })
  .strict();

export const publicCustomerResetPasswordSchema = z
  .object({ token: z.string().min(20), password: publicCustomerPasswordSchema })
  .strict();

export const publicCustomerProfileSchema = z
  .object({
    fullName: publicNameSchema,
    phone: optionalPhoneSchema,
    newsletterOptIn: z.boolean(),
  })
  .strict();

export const publicCustomerChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Le mot de passe actuel est requis").max(128),
    newPassword: publicCustomerPasswordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ["newPassword"],
    message: "Le nouveau mot de passe doit être différent de l’ancien",
  });

export type PublicCustomerRegisterInput = z.infer<
  typeof publicCustomerRegisterSchema
>;
export type PublicCustomerLoginInput = z.infer<
  typeof publicCustomerLoginSchema
>;
export type PublicCustomerVerificationCodeInput = z.infer<
  typeof publicCustomerVerificationCodeSchema
>;
export type PublicCustomerResendVerificationInput = z.infer<
  typeof publicCustomerResendVerificationSchema
>;
export type PublicCustomerProfileInput = z.infer<
  typeof publicCustomerProfileSchema
>;
