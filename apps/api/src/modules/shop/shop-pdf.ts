/**
 * Printable documents for website shop orders: customer order form (Bon de
 * commande) and delivery note (Bon de livraison). Access follows the shop
 * orders list (sales.read / sales.update or owner, website channel only).
 */
import { BadRequestError } from "../../utils/errors";
import { createPdf, pdfDate, pdfMoney } from "../../utils/pdf-builder";
import { withTenantContext } from "../../utils/tenant-query";
import type { ChatContext } from "../chat/chat.service";
import { webOrderForPdf } from "./shop.service";

type PdfFile = { buffer: Buffer; fileName: string };

const STATUS: Record<string, string> = {
  draft: "À confirmer",
  confirmed: "Confirmée",
  partially_delivered: "En partie livrée",
  delivered: "Livrée",
  invoiced: "Facturée",
  cancelled: "Annulée",
};
const qty = (value: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(value).replace(/ | /g, " ");
const fileSafe = (value: unknown) => String(value ?? "").replace(/[^\w-]+/g, "-") || "commande";
const modeLabel = (mode: string | null) => (mode === "delivery" ? "Livraison à domicile" : mode === "pickup" ? "Retrait sur place" : "—");

export async function shopOrderFormPdf(context: ChatContext, orderId: string): Promise<PdfFile> {
  return withTenantContext(context, async (client) => {
    const data = await webOrderForPdf(context, orderId, client);
    const { order } = data;
    const currency = order.currency;
    const pdf = await createPdf(client, context.organizationId, {
      title: "Bon de commande",
      reference: order.number,
      subtitle: `Commande en ligne · ${STATUS[order.status] ?? order.status}`,
    });
    pdf.section("Client").fields([
      ["Nom", order.contact.name],
      ["Référence client", data.customerCode],
      ["Téléphone", order.contact.phone],
      ["E-mail", order.contact.email],
    ]);
    pdf.section("Commande").fields(
      [
        ["Date de commande", pdfDate(order.createdAt, true)],
        ["Statut", STATUS[order.status] ?? order.status],
        ["Date souhaitée", pdfDate(data.requiredDate)],
        ["Mode de remise", modeLabel(order.deliveryMode)],
        ["Adresse de livraison", order.deliveryMode === "delivery" ? order.deliveryAddress : "—"],
        ["Devise", currency],
      ],
      3,
    );
    if (order.note) pdf.paragraph(`Message du client : « ${order.note} »`);
    pdf.section("Articles commandés");
    pdf.table(
      [
        { label: "N°", width: 0.4, align: "center" },
        { label: "Désignation", width: 3 },
        { label: "Quantité", width: 1, align: "right" },
        { label: "Unité", width: 0.8 },
        { label: "Prix unitaire", width: 1.3, align: "right" },
        { label: "Montant", width: 1.4, align: "right" },
      ],
      data.lines.map((line, index) => [index + 1, line.description, qty(line.quantity), line.unit, pdfMoney(line.unitPrice, currency), pdfMoney(line.total, currency)]),
      { empty: "Aucun article.", totals: ["", "Total de la commande", "", "", "", pdfMoney(order.total, currency)] },
    );
    if (order.status === "cancelled") pdf.note(`Commande annulée${order.cancelledReason ? ` : ${order.cancelledReason}` : "."}`);
    const terms = [data.settings.paymentNote, data.settings.orderNote].filter((value): value is string => Boolean(value && value.trim()));
    if (terms.length) pdf.section("Conditions").paragraph(terms.join("\n\n"));
    pdf.note("Les prix et la disponibilité sont confirmés par l'entreprise. La commande n'est ferme qu'après confirmation. La facture est remise après la livraison.");
    pdf.signatures(["Le client (bon pour commande)", "Pour l'entreprise"]);
    return { buffer: await pdf.finish(), fileName: `bon-de-commande-${fileSafe(order.number)}.pdf` };
  });
}

export async function shopDeliveryNotePdf(context: ChatContext, orderId: string): Promise<PdfFile> {
  return withTenantContext(context, async (client) => {
    const data = await webOrderForPdf(context, orderId, client);
    const { order } = data;
    if (order.status === "cancelled") throw new BadRequestError("Commande annulée : aucun bon de livraison ne peut être édité.");
    const delivered = data.deliveries.filter((delivery) => String(delivery.status) === "delivered");
    const last = delivered[delivered.length - 1];
    const pdf = await createPdf(client, context.organizationId, {
      title: "Bon de livraison",
      reference: order.number,
      subtitle: `${modeLabel(order.deliveryMode)} · ${STATUS[order.status] ?? order.status}`,
    });
    pdf.section("Destinataire").fields([
      ["Client", order.contact.name],
      ["Téléphone", order.contact.phone],
      ["Adresse de livraison", order.deliveryMode === "delivery" ? order.deliveryAddress : "Retrait sur place"],
      ["Commande du", pdfDate(order.createdAt)],
    ]);
    pdf.section("Livraison").fields(
      [
        ["Date de livraison", last ? pdfDate(last.delivered_on) : "____ / ____ / ________"],
        ["Bon(s) de sortie", delivered.length ? delivered.map((delivery) => String(delivery.delivery_number)).join(", ") : "—"],
        ["Livreur", last?.driver_name ?? ""],
      ],
      3,
    );
    if (order.note) pdf.paragraph(`Instructions du client : « ${order.note} »`);
    pdf.section("Marchandises");
    pdf.table(
      [
        { label: "N°", width: 0.4, align: "center" },
        { label: "Désignation", width: 3 },
        { label: "Unité", width: 0.8 },
        { label: "Qté commandée", width: 1.1, align: "right" },
        { label: "Qté livrée", width: 1.1, align: "right" },
        { label: "Observations", width: 1.8 },
      ],
      // Delivered quantity is printed when recorded, otherwise left blank to fill by hand.
      data.lines.map((line, index) => [index + 1, line.description, line.unit, qty(line.quantity), line.deliveredQuantity > 0 ? qty(line.deliveredQuantity) : "", ""]),
      { empty: "Aucun article." },
    );
    pdf.paragraph("Nombre de colis : ________        État des marchandises à la réception : [  ] Conforme    [  ] Avec réserves (préciser ci-dessus)", { size: 9 });
    pdf.note("Le client reconnaît avoir reçu les marchandises ci-dessus. Toute réserve (manquant, casse, qualité) doit être notée sur ce bon au moment de la livraison. Ce document ne vaut pas facture.");
    pdf.signatures(["Livré par", "Reçu par (client)"]);
    return { buffer: await pdf.finish(), fileName: `bon-de-livraison-${fileSafe(order.number)}.pdf` };
  });
}
