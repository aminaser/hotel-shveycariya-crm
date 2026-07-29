import type { ActDocument } from "@/api/types";
import { formatDate } from "@/lib/format";

interface InvoiceDocumentPrintProps {
  document: ActDocument;
  hotelBin?: string | null;
  hotelDirector?: string | null;
}

const EXECUTOR_LONG =
  'ИП Торгово-развлекательный комплекс "Швейцария" Бектурова Ж.К.';
const EXECUTOR_ADDRESS = "Алматинская область, г. Текели, ул. Ы. Алтынсарина, 20";
const EXECUTOR_IBAN = "KZ616010311000181781";
const EXECUTOR_BANK = 'АО "Народный Банк Казахстана"';
const EXECUTOR_BIK = "HSBKKZKX";
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

function amountWords(doc: ActDocument): string {
  const words = doc.total_amount_words || "";
  if (words.toLowerCase().includes("тиын")) return words;
  return words ? `${words} 00 тиын` : "";
}

export function InvoiceDocumentPrint({
  document: doc,
  hotelBin,
  hotelDirector,
}: InvoiceDocumentPrintProps) {
  const bin = (hotelBin || "571031400540").trim();
  const director = hotelDirector || EXECUTOR_DIRECTOR;
  const invoiceDate = `${formatDate(doc.act_date)}г.`;

  return (
    <div className="act-print invoice-print mx-auto max-w-[1100px] bg-white p-4 text-[10px] leading-tight text-black print:p-0 print:text-[9px]">
      <p className="mb-3 text-center text-[13px] font-bold">
        Счет-фактура №&nbsp;&nbsp;{doc.act_number}&nbsp;&nbsp;от&nbsp;&nbsp;{invoiceDate}
      </p>

      <div className="mb-3 space-y-0.5">
        <p>Поставщик: {EXECUTOR_LONG}</p>
        <p>
          БИН и адрес поставщика: ИИН {bin}&nbsp;&nbsp;{EXECUTOR_ADDRESS}
        </p>
        <p>
          Реквизиты поставщика:&nbsp;&nbsp;{EXECUTOR_IBAN} в {EXECUTOR_BANK},&nbsp;&nbsp;БИК{" "}
          {EXECUTOR_BIK}
        </p>
        <p>
          Договор (контракт) на поставку товаров (работ, услуг):{" "}
          {doc.contract_number || ""}
        </p>
        <p>Условия оплаты по договору (контракту): б/нал. расчет</p>
        <p>
          Поставка товаров (работ, услуг) осуществлена по доверенности: Без доверенности
        </p>
        <p>Способ отправления:</p>
        <p>Товарно-транспортная накладная:</p>
        <p>
          Грузоотправитель: {EXECUTOR_LONG} {EXECUTOR_ADDRESS}
        </p>
        <p className="pt-1">Покупатель:&nbsp;&nbsp;{doc.customer.name}</p>
        <p>
          РНН и адрес покупателя :&nbsp;&nbsp;{doc.customer.identifier_label}:&nbsp;&nbsp;
          {doc.customer.identifier}
          {doc.customer.address ? `,   ${doc.customer.address}` : ""}
        </p>
        <p>
          IBAN покупателя:&nbsp;&nbsp;ИИК:&nbsp;&nbsp;{doc.customer.iban || ""}
        </p>
      </div>

      <table className="w-full border-collapse text-[9px]">
        <thead>
          <tr>
            <th className="border border-black px-0.5 py-1 align-middle" rowSpan={2}>
              № п/п
            </th>
            <th className="border border-black px-0.5 py-1 align-middle" rowSpan={2}>
              Наименование товаров (работ, услуг)
            </th>
            <th className="border border-black px-0.5 py-1 align-middle" rowSpan={2}>
              Ед. изм.
            </th>
            <th className="border border-black px-0.5 py-1 align-middle" rowSpan={2}>
              Кол-во (объем)
            </th>
            <th className="border border-black px-0.5 py-1 align-middle" rowSpan={2}>
              Цена тенге
            </th>
            <th className="border border-black px-0.5 py-1 align-middle" rowSpan={2}>
              Стоимость товаров (работ, услуг) без НДС
            </th>
            <th className="border border-black px-0.5 py-1 align-middle" colSpan={2}>
              НДС
            </th>
            <th className="border border-black px-0.5 py-1 align-middle" rowSpan={2}>
              Всего стоимость реализации
            </th>
            <th className="border border-black px-0.5 py-1 align-middle" colSpan={2}>
              Акциз
            </th>
          </tr>
          <tr>
            <th className="border border-black px-0.5 py-0.5">Ставка</th>
            <th className="border border-black px-0.5 py-0.5">Сумма</th>
            <th className="border border-black px-0.5 py-0.5">Ставка</th>
            <th className="border border-black px-0.5 py-0.5">Сумма</th>
          </tr>
          <tr>
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"].map((n) => (
              <th key={n} className="border border-black px-0.5 py-0.5 font-normal">
                {n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {doc.line_items.map((item) => (
            <tr key={item.line_no}>
              <td className="border border-black px-0.5 py-0.5 text-center">{item.line_no}</td>
              <td className="border border-black px-0.5 py-0.5 text-left">{item.description}</td>
              <td className="border border-black px-0.5 py-0.5 text-center">{item.unit}</td>
              <td className="border border-black px-0.5 py-0.5 text-right">
                {formatQty(item.quantity)}
              </td>
              <td className="border border-black px-0.5 py-0.5 text-right">
                {formatAmount(item.unit_price)}
              </td>
              <td className="border border-black px-0.5 py-0.5 text-right">
                {formatAmount(item.amount)}
              </td>
              <td className="border border-black px-0.5 py-0.5 text-center">Без НДС</td>
              <td className="border border-black px-0.5 py-0.5" />
              <td className="border border-black px-0.5 py-0.5 text-right">
                {formatAmount(item.amount)}
              </td>
              <td className="border border-black px-0.5 py-0.5" />
              <td className="border border-black px-0.5 py-0.5" />
            </tr>
          ))}
          <tr>
            <td className="border border-black px-0.5 py-1 font-semibold" colSpan={1}>
              Всего по счету
            </td>
            <td className="border border-black px-0.5 py-1 font-semibold" colSpan={7}>
              {amountWords(doc)}
            </td>
            <td className="border border-black px-0.5 py-1 text-right font-semibold">
              {formatAmount(doc.total_amount)}
            </td>
            <td className="border border-black px-0.5 py-1" />
            <td className="border border-black px-0.5 py-1" />
          </tr>
        </tbody>
      </table>

      <div className="mt-4 grid grid-cols-2 gap-8">
        <div>
          <p>Руководитель:&nbsp;&nbsp;{director}</p>
          <p className="mt-1 text-center text-[9px]">(Ф.И.О., подпись)</p>
          <p className="mt-3">Главный бухгалтер&nbsp;&nbsp;не предусмотрен</p>
          <p className="mt-1 text-center text-[9px]">(Ф.И.О., подпись)</p>
        </div>
        <div>
          <p>ВЫДАЛ {director}</p>
          <p className="mt-1 text-center text-[9px]">(должность)</p>
          <p className="mt-3">Бухгалтер</p>
          <p className="mt-1 text-center text-[9px]">(Ф.И.О., подпись)</p>
        </div>
      </div>

      <p className="mt-4 text-[8px]">
        Примечание: Без печати не действительно. Оригинал (первый экземпляр) - покупателю.
        Копия (второй экземпляр) - поставщику.
      </p>
    </div>
  );
}
