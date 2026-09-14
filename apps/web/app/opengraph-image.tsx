import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "LiteHubs — logiciel de gestion avicole, porcine et agricole";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ background: "#0b3329", color: "white", display: "flex", height: "100%", width: "100%", fontFamily: "Arial, sans-serif", overflow: "hidden", padding: "64px", position: "relative" }}>
        <div style={{ background: "#1e8f71", borderRadius: "999px", filter: "blur(8px)", height: "540px", opacity: 0.24, position: "absolute", right: "-160px", top: "-210px", width: "540px" }} />
        <div style={{ background: "#d9a841", borderRadius: "999px", bottom: "-270px", height: "480px", left: "-150px", opacity: 0.12, position: "absolute", width: "480px" }} />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative", width: "100%" }}>
          <div style={{ alignItems: "center", display: "flex", gap: "18px" }}>
            <div style={{ alignItems: "center", background: "#e7f6ed", borderRadius: "18px", color: "#0b3329", display: "flex", fontSize: "34px", fontWeight: 800, height: "66px", justifyContent: "center", letterSpacing: "-2px", width: "66px" }}>L</div>
            <div style={{ fontSize: "38px", fontWeight: 800, letterSpacing: "1px" }}>LITEHUBS</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: "930px" }}>
            <div style={{ color: "#a7f3d0", fontSize: "22px", fontWeight: 700, letterSpacing: "4px", marginBottom: "18px" }}>GESTION OPÉRATIONNELLE</div>
            <div style={{ fontSize: "66px", fontWeight: 800, letterSpacing: "-2.5px", lineHeight: 1.08 }}>Aviculture, porcs et agriculture. Une seule vue.</div>
            <div style={{ color: "#d5eee2", fontSize: "27px", lineHeight: 1.35, marginTop: "22px" }}>Équipes, productions, santé, stocks et décisions, reliés au terrain.</div>
          </div>
          <div style={{ display: "flex", gap: "14px" }}>
            {["Aviculture", "Élevage porcin", "Agriculture", "Équipes"].map((label) => <div key={label} style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.22)", borderRadius: "999px", fontSize: "19px", fontWeight: 700, padding: "11px 20px" }}>{label}</div>)}
          </div>
        </div>
      </div>
    ),
    size,
  );
}