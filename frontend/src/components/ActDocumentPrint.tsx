import type { ActDocument, ActLookupResult, AppSettings } from "@/api/types";
import { formatDate } from "@/lib/format";

interface ActDocumentPrintProps {
  document: ActDocument;
  hotelDirector?: string | null;
}

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

function partyLine(name: string, address: string | null | undefined): string {
  if (address) return `${name}, ${address}`;
  return name;
}

export function ActDocumentPrint({ document: doc, hotelDirector }: ActDocumentPrintProps) {
  const directorName = hotelDirector || "___________________";

  return (
    <div className="act-print mx-auto max-w-[1100px] bg-white p-4 text-[10px] leading-tight text-black print:p-0 print:text-[9px]">
      <div className="mb-2 text-right text-[9px]">
        <p>Приложение 50</p>
        <p>к приказу Министра финансов</p>
        <p>Республики Казахстан</p>
        <p>от 20 декабря 2012 года № 562</p>
        <p className="mt-1 font-semibold">Форма Р-1</p>
      </div>

      <table className="mb-0 w-full border-collapse">
        <tbody>
          <tr>
            <td className="w-24 border border-black px-1 py-0.5 align-top">ИИН/БИН</td>
            <td className="w-20 border border-black px-1 py-0.5 align-top">Заказчик</td>
            <td className="border border-black px-1 py-0.5 align-top" colSpan={6}>
              {partyLine(doc.customer.name, doc.customer.address)}
              {doc.customer.iban ? (
                <>
                  <br />
                  ИИК: {doc.customer.iban}
                </>
              ) : null}
            </td>
            <td className="w-28 border border-black px-1 py-0.5 text-center align-middle">
              {doc.customer.identifier || " "}
            </td>
          </tr>
          <tr>
            <td className="border border-black px-1 py-0.5" colSpan={2} />
            <td className="border border-black px-1 py-0.5 text-[8px] text-gray-600" colSpan={7}>
              полное наименование, адрес, данные о средствах связи
            </td>
          </tr>
          <tr>
            <td className="border border-black px-1 py-0.5 align-top">ИИН/БИН</td>
            <td className="border border-black px-1 py-0.5 align-top">Исполнитель</td>
            <td className="border border-black px-1 py-0.5 align-top" colSpan={6}>
              {partyLine(doc.executor.name, doc.executor.address)}
            </td>
            <td className="border border-black px-1 py-0.5 text-center align-middle">
              {doc.executor.identifier || " "}
            </td>
          </tr>
          <tr>
            <td className="border border-black px-1 py-0.5" colSpan={2} />
            <td className="border border-black px-1 py-0.5 text-[8px] text-gray-600" colSpan={7}>
              полное наименование, адрес, данные о средствах связи
            </td>
          </tr>
          <tr>
            <td className="border border-black px-1 py-1 align-top" colSpan={2}>
              Договор (контракт)
            </td>
            <td className="border border-black px-1 py-1 align-top" colSpan={4}>
              {doc.contract_number || " "}
            </td>
            <td className="border border-black px-1 py-1 align-top">Номер документа</td>
            <td className="border border-black px-1 py-1 text-center align-middle">
              {doc.act_number}
            </td>
            <td className="border border-black px-1 py-1 align-top">Дата составления</td>
            <td className="border border-black px-1 py-1 text-center align-middle">
              {formatDate(doc.act_date)}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="my-1 text-center text-[11px] font-bold uppercase">
        Акт выполненных работ (оказанных услуг)
      </p>

      <table className="mb-1 w-full border-collapse">
        <thead>
          <tr>
            <th className="border border-black px-1 py-1 align-middle" rowSpan={2}>
              Номер по порядку
            </th>
            <th className="border border-black px-1 py-1 align-middle" rowSpan={2}>
              Наименование работ (услуг) (в разрезе их подвидов в соответствии с технической
              спецификацией, заданием, графиком выполнения работ (услуг) при их наличии)
            </th>
            <th className="border border-black px-1 py-1 align-middle" rowSpan={2}>
              Дата выполнения работ (оказания услуг)
            </th>
            <th className="border border-black px-1 py-1 align-middle" rowSpan={2}>
              Сведения об отчете о научных исследованиях, маркетинговых, консультационных и прочих
              услугах (дата, номер, количество страниц) (при их наличии)
            </th>
            <th className="border border-black px-1 py-1 align-middle" rowSpan={2}>
              Единица измерения
            </th>
            <th className="border border-black px-1 py-1 align-middle" colSpan={4}>
              Выполнено работ (оказано услуг)
            </th>
          </tr>
          <tr>
            <th className="border border-black px-1 py-1 align-middle">количество</th>
            <th className="border border-black px-1 py-1 align-middle">цена за единицу</th>
            <th className="border border-black px-1 py-1 align-middle">стоимость</th>
            <th className="border border-black px-1 py-1 align-middle">
              в том числе НДС, в KZT
            </th>
          </tr>
          <tr className="text-center">
            <th className="border border-black px-1 py-0.5">1</th>
            <th className="border border-black px-1 py-0.5">2</th>
            <th className="border border-black px-1 py-0.5">3</th>
            <th className="border border-black px-1 py-0.5">4</th>
            <th className="border border-black px-1 py-0.5">5</th>
            <th className="border border-black px-1 py-0.5">6</th>
            <th className="border border-black px-1 py-0.5">7</th>
            <th className="border border-black px-1 py-0.5">8</th>
            <th className="border border-black px-1 py-0.5">9</th>
          </tr>
        </thead>
        <tbody>
          {doc.line_items.map((item) => (
            <tr key={`${item.line_no}-${item.description}`}>
              <td className="border border-black px-1 py-1 text-center align-top">
                {item.line_no}
              </td>
              <td className="border border-black px-1 py-1 align-top">{item.description}</td>
              <td className="border border-black px-1 py-1 align-top whitespace-nowrap">
                {item.service_date}
              </td>
              <td className="border border-black px-1 py-1 align-top" />
              <td className="border border-black px-1 py-1 text-center align-top">{item.unit}</td>
              <td className="border border-black px-1 py-1 text-right align-top">
                {formatQty(item.quantity)}
              </td>
              <td className="border border-black px-1 py-1 text-right align-top">
                {formatAmount(item.unit_price)}
              </td>
              <td className="border border-black px-1 py-1 text-right align-top">
                {formatAmount(item.amount)}
              </td>
              <td className="border border-black px-1 py-1 text-right align-top">
                {formatAmount(item.vat_amount)}
              </td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="border border-black px-1 py-1 align-top">Итого</td>
            <td className="border border-black px-1 py-1 text-right align-top">
              {formatQty(doc.total_quantity)}
            </td>
            <td className="border border-black px-1 py-1 align-top">х</td>
            <td className="border border-black px-1 py-1 align-top" colSpan={2} />
            <td className="border border-black px-1 py-1 align-top" />
            <td className="border border-black px-1 py-1 align-top" />
            <td className="border border-black px-1 py-1 text-right align-top">
              {formatAmount(doc.total_amount)}
            </td>
            <td className="border border-black px-1 py-1 text-right align-top">
              {formatAmount(doc.total_vat)}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="mb-1 border border-black px-1 py-1">
        Сведения об использовании запасов, полученных от заказчика: наименование, количество,
        стоимость
      </p>

      <p className="mb-2 border border-black px-1 py-1 text-[8px]">
        Приложение: Перечень документации, в том числе отчет(ы) о маркетинговых, научных
        исследованиях, консультационных и прочих услугах (обязательны при его (их) наличии) на
        _____________ страниц
      </p>

      <table className="mb-2 w-full border-collapse">
        <tbody>
          <tr>
            <td className="w-1/2 border border-black px-1 py-1 align-top">
              <p className="mb-6">Сдал (Исполнитель)</p>
              <table className="w-full text-[9px]">
                <tbody>
                  <tr>
                    <td className="pb-4">Директор</td>
                    <td className="pb-4 text-center">/</td>
                    <td className="pb-4 text-center">{directorName}</td>
                  </tr>
                  <tr className="text-[8px] text-gray-600">
                    <td>должность</td>
                    <td className="text-center">подпись</td>
                    <td className="text-center">расшифровка подписи</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-2">М.П.</p>
            </td>
            <td className="w-1/2 border border-black px-1 py-1 align-top">
              <p className="mb-6">Принял (Заказчик)</p>
              <table className="w-full text-[9px]">
                <tbody>
                  <tr>
                    <td className="pb-4">&nbsp;</td>
                    <td className="pb-4 text-center">/</td>
                    <td className="pb-4 text-center">&nbsp;</td>
                  </tr>
                  <tr className="text-[8px] text-gray-600">
                    <td>должность</td>
                    <td className="text-center">подпись</td>
                    <td className="text-center">расшифровка подписи</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-2">М.П.</p>
            </td>
          </tr>
          <tr>
            <td className="border border-black px-1 py-1" colSpan={2}>
              Дата подписания (принятия) работ (услуг): {formatDate(doc.act_date)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
