import type { ActDocument } from "@/api/types";
import { formatDate } from "@/lib/format";

interface PaymentInvoiceDocumentPrintProps {
  document: ActDocument;
  hotelBin?: string | null;
  hotelDirector?: string | null;
}

const EXECUTOR_SHORT = 'ИП ТРК "Швейцария" Бектурова Ж.К.';
const EXECUTOR_ADDRESS = "Алматинская область, г. Текели, ул. Ы. Алтынсарина, 20";
const EXECUTOR_IBAN = "KZ616010311000181781";
const EXECUTOR_BANK = 'АО "Народный Банк Казахстана"';
const EXECUTOR_BIK = "HSBKKZKX";
const EXECUTOR_KBE = "19";
const PAYMENT_CODE = "872";
const EXECUTOR_DIRECTOR = "Бектурова Ж.К.";

function formatAmount(value: string | number): string {
  const amount = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(amount)) return "";
  return new Intl.NumberFormat("ru-KZ", {
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatQty(value: string | number): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(n)) return "";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function formatMoneyPlain(value: string | number): string {
  const amount = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(amount)) return "0.00";
  return amount.toLocaleString("ru-KZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function customerText(doc: ActDocument): string {
  let text = doc.customer.name;
  if (doc.customer.address) text += `, ${doc.customer.address}`;
  if (doc.customer.identifier) {
    text += `, ${doc.customer.identifier_label}: ${doc.customer.identifier}`;
  }
  if (doc.customer.iban) text += `, ИИК: ${doc.customer.iban}`;
  return text;
}

function amountWords(doc: ActDocument): string {
  const words = doc.total_amount_words || "";
  if (words.toLowerCase().includes("тиын")) return words;
  return words ? `${words} 00 тиын` : "";
}

export function PaymentInvoiceDocumentPrint({
  document: doc,
  hotelBin,
  hotelDirector,
}: PaymentInvoiceDocumentPrintProps) {
  const bin = (hotelBin || "571031400540").trim();
  const director = hotelDirector || EXECUTOR_DIRECTOR;
  const invoiceDate = `${formatDate(doc.act_date)}г.`;

  return (
    <div className="act-print payment-invoice-print mx-auto max-w-[800px] bg-white p-4 text-[10px] leading-tight text-black print:p-0 print:text-[9px]">
      <p className="mb-4 text-[8px] leading-snug text-muted-foreground print:text-black">
        Внимание! Оплата данного счета означает согласие с условиями поставки товара.
        Уведомление об оплате обязательно, в противном случае не гарантируется наличие
        товара на складе. Товар отпускается по факту прихода денег на р/с Поставщика,
        самовывозом, при наличии доверенности и документов, удостоверяющих личность.
      </p>

      <p className="mb-2 text-center text-[11px] font-bold">Образец платежного поручения</p>

      <table className="mb-4 w-full border-collapse text-[9px]">
        <tbody>
          <tr>
            <td className="border border-black px-1 py-1" colSpan={2}>
              Бенефициар: {EXECUTOR_SHORT}
            </td>
            <td className="border border-black px-1 py-1 text-center">ИИК</td>
            <td className="border border-black px-1 py-1 text-center w-14">Кбе</td>
          </tr>
          <tr>
            <td className="border border-black px-1 py-1" colSpan={2}>
              БИН: {bin}
            </td>
            <td className="border border-black px-1 py-1 text-center font-medium">
              {EXECUTOR_IBAN}
            </td>
            <td className="border border-black px-1 py-1 text-center">{EXECUTOR_KBE}</td>
          </tr>
          <tr>
            <td className="border border-black px-1 py-1" colSpan={2}>
              Банк бенефициара: {EXECUTOR_BANK}
            </td>
            <td className="border border-black px-1 py-1 text-center">БИК</td>
            <td className="border border-black px-1 py-1 text-center text-[8px]">
              Код назначения платежа
            </td>
          </tr>
          <tr>
            <td className="border border-black px-1 py-1" colSpan={2} />
            <td className="border border-black px-1 py-1 text-center font-medium">
              {EXECUTOR_BIK}
            </td>
            <td className="border border-black px-1 py-1 text-center">{PAYMENT_CODE}</td>
          </tr>
        </tbody>
      </table>

      <p className="mb-3 text-center text-[13px] font-bold">
        Счет на оплату №&nbsp;&nbsp;{doc.act_number}&nbsp;&nbsp;от&nbsp;&nbsp;{invoiceDate}
      </p>

      <p className="mb-1">
        Поставщик: {EXECUTOR_SHORT}, {EXECUTOR_ADDRESS}, БИН: {bin}
      </p>
      <p className="mb-3">Покупатель: {customerText(doc)}</p>

      <table className="w-full border-collapse text-[9px]">
        <thead>
          <tr>
            <th className="border border-black px-1 py-1 w-8">№</th>
            <th className="border border-black px-1 py-1 w-12">Код</th>
            <th className="border border-black px-1 py-1">Наименование</th>
            <th className="border border-black px-1 py-1 w-14">Кол-во</th>
            <th className="border border-black px-1 py-1 w-12">Ед.</th>
            <th className="border border-black px-1 py-1 w-16">Цена</th>
            <th className="border border-black px-1 py-1 w-16">Сумма</th>
          </tr>
        </thead>
        <tbody>
          {doc.line_items.map((item) => {
            const description = item.service_date
              ? `${item.description} (${item.service_date})`
              : item.description;
            return (
              <tr key={item.line_no}>
                <td className="border border-black px-1 py-0.5 text-center">{item.line_no}</td>
                <td className="border border-black px-1 py-0.5" />
                <td className="border border-black px-1 py-0.5 text-left">{description}</td>
                <td className="border border-black px-1 py-0.5 text-right">
                  {formatQty(item.quantity)}
                </td>
                <td className="border border-black px-1 py-0.5 text-center">{item.unit}</td>
                <td className="border border-black px-1 py-0.5 text-right">
                  {formatAmount(item.unit_price)}
                </td>
                <td className="border border-black px-1 py-0.5 text-right">
                  {formatAmount(item.amount)}
                </td>
              </tr>
            );
          })}
          <tr>
            <td className="border border-black px-1 py-1 text-right font-semibold" colSpan={6}>
              Итого:
            </td>
            <td className="border border-black px-1 py-1 text-right font-semibold">
              {formatAmount(doc.total_amount)}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="mt-2">
        Всего наименований: {doc.line_items.length}, на сумму {formatMoneyPlain(doc.total_amount)}{" "}
        ₸
      </p>
      <p className="mt-1 font-semibold">{amountWords(doc)}</p>

      <div className="mt-8 flex items-end gap-4">
        <span>Исполнитель</span>
        <span className="min-w-[160px] border-b border-black">&nbsp;</span>
        <span>{director}</span>
      </div>
    </div>
  );
}
