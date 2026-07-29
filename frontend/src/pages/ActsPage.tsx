import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Printer, Search, Trash2, FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { apiDownload, apiFetch, ApiError } from "@/api/client";
import type { ActDocument, ActLineItemInput, ActLookupResult } from "@/api/types";
import { ActDocumentPrint } from "@/components/ActDocumentPrint";
import { InvoiceDocumentPrint } from "@/components/InvoiceDocumentPrint";
import { PaymentInvoiceDocumentPrint } from "@/components/PaymentInvoiceDocumentPrint";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { todayLocal } from "@/lib/dates";

type RecipientType = "individual" | "organization";

interface LineRow extends ActLineItemInput {
  id: string;
}

function monthStart(): string {
  const today = todayLocal();
  return `${today.slice(0, 8)}01`;
}

function emptyLine(): LineRow {
  return {
    id: crypto.randomUUID(),
    description: "",
    service_date: "",
    unit: "услуга",
    quantity: "1",
    unit_price: "0",
    vat_amount: "0",
  };
}

function lineAmount(row: LineRow): number {
  const qty = parseFloat(row.quantity) || 0;
  const price = parseFloat(row.unit_price) || 0;
  return Math.round(qty * price);
}

export function ActsPage() {
  const queryClient = useQueryClient();
  const [recipientType, setRecipientType] = useState<RecipientType>("individual");
  const [identifier, setIdentifier] = useState("");
  const [lookup, setLookup] = useState<ActLookupResult | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerIban, setCustomerIban] = useState("");
  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(todayLocal());
  const [actDate, setActDate] = useState(todayLocal());
  const [contractNumber, setContractNumber] = useState("");
  const [lines, setLines] = useState<LineRow[]>([emptyLine()]);
  const [actDocument, setActDocument] = useState<ActDocument | null>(null);
  const [printView, setPrintView] = useState<"act" | "invoice" | "payment">("act");

  const { data: nextNumber } = useQuery({
    queryKey: ["acts", "next-number"],
    queryFn: () => apiFetch<{ next_number: number }>("/acts/next-number"),
  });

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<import("@/api/types").AppSettings>("/settings"),
  });

  const searchMutation = useMutation({
    mutationFn: async () => {
      const param =
        recipientType === "individual"
          ? `iin=${encodeURIComponent(identifier.trim())}`
          : `bin=${encodeURIComponent(identifier.trim())}`;
      return apiFetch<ActLookupResult>(`/acts/lookup?${param}`);
    },
    onSuccess: (data) => {
      setLookup(data);
      if (data.found) {
        setCustomerName(data.full_name ?? "");
        toast.success("Заказчик найден в базе");
      } else {
        toast.message("Не найден в базе — заполните вручную");
      }
    },
    onError: (e) => {
      if (e instanceof ApiError) toast.error(e.message);
      else toast.error("Ошибка поиска");
    },
  });

  const journalMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ line_items: ActDocument["line_items"] }>("/acts/journal-lines", {
        method: "POST",
        body: JSON.stringify({
          recipient_type: recipientType,
          iin: recipientType === "individual" ? identifier.trim() || null : null,
          bin: recipientType === "organization" ? identifier.trim() || null : null,
          client_id: lookup?.client_id ?? null,
          date_from: dateFrom,
          date_to: dateTo,
        }),
      }),
    onSuccess: (data) => {
      const journalLines: LineRow[] = data.line_items.map((item) => ({
        id: crypto.randomUUID(),
        description: item.description,
        service_date: item.service_date,
        unit: item.unit,
        quantity: String(item.quantity),
        unit_price: String(item.unit_price),
        vat_amount: String(item.vat_amount),
      }));
      setLines(journalLines.length > 0 ? journalLines : [emptyLine()]);
      toast.success("Строки заполнены из журнала");
    },
    onError: (e) => {
      if (e instanceof ApiError) toast.error(e.message);
      else toast.error("Не удалось загрузить из журнала");
    },
  });

  const buildPreviewPayload = () => {
    const lineItems = lines
      .filter((row) => row.description.trim())
      .map((row) => ({
        description: row.description.trim(),
        service_date: row.service_date.trim() || actDate,
        unit: row.unit.trim() || "услуга",
        quantity: row.quantity || "1",
        unit_price: row.unit_price || "0",
        amount: String(lineAmount(row)),
        vat_amount: row.vat_amount || "0",
      }));

    return {
      recipient_type: recipientType,
      iin: recipientType === "individual" ? identifier.trim() || null : null,
      bin: recipientType === "organization" ? identifier.trim() || null : null,
      client_id: lookup?.client_id ?? null,
      customer_name: customerName.trim(),
      customer_address: customerAddress.trim() || null,
      customer_iban: customerIban.trim() || null,
      act_date: actDate,
      date_from: dateFrom,
      date_to: dateTo,
      // Reuse the number of the already formed document so that the act,
      // invoice and payment invoice of one deal share the same number.
      act_number: actDocument?.act_number ?? null,
      contract_number: contractNumber.trim() || null,
      line_items: lineItems,
      // No manual lines — fill from the journal for the selected period.
      use_journal: lineItems.length === 0,
    };
  };

  const previewAct = () =>
    apiFetch<ActDocument>("/acts/preview", {
      method: "POST",
      body: JSON.stringify(buildPreviewPayload()),
    });

  const EXPORT_DOCS = {
    act: {
      path: "/acts/export",
      filePrefix: "akt",
      label: "Акт выполненных работ",
    },
    invoice: {
      path: "/acts/export/invoice",
      filePrefix: "schet-faktura",
      label: "Счёт-фактура",
    },
    payment: {
      path: "/acts/export/payment-invoice",
      filePrefix: "schet-na-oplatu",
      label: "Счёт на оплату",
    },
  } as const;

  type ExportDocType = keyof typeof EXPORT_DOCS;

  const downloadDocExcel = async (docType: ExportDocType, document: ActDocument) => {
    const doc = EXPORT_DOCS[docType];
    await apiDownload(
      doc.path,
      {
        method: "POST",
        body: JSON.stringify(document),
      },
      `${doc.filePrefix}-${document.act_number}.xlsx`,
    );
  };

  const previewMutation = useMutation({
    mutationFn: previewAct,
    onSuccess: (data) => {
      setActDocument(data);
      queryClient.invalidateQueries({ queryKey: ["acts", "next-number"] });
      toast.success("Акт сформирован");
    },
    onError: (e) => {
      if (e instanceof ApiError) toast.error(e.message);
      else toast.error("Не удалось сформировать акт");
    },
  });

  const exportExcelMutation = useMutation({
    mutationFn: async (docType: ExportDocType) => {
      const document = await previewAct();
      await downloadDocExcel(docType, document);
      return { document, docType };
    },
    onSuccess: ({ document, docType }) => {
      setActDocument(document);
      if (docType === "act" || docType === "invoice" || docType === "payment") {
        setPrintView(docType);
      }
      queryClient.invalidateQueries({ queryKey: ["acts", "next-number"] });
      toast.success(`${EXPORT_DOCS[docType].label} — Excel скачан`);
    },
    onError: (e) => {
      if (e instanceof ApiError) toast.error(e.message);
      else toast.error("Не удалось скачать Excel");
    },
  });

  const handleSearch = () => {
    const cleaned = identifier.trim();
    if (cleaned.length !== 12) {
      toast.error(
        recipientType === "individual"
          ? "ИИН должен содержать 12 цифр"
          : "БИН должен содержать 12 цифр",
      );
      return;
    }
    searchMutation.mutate();
  };

  const updateLine = (id: string, patch: Partial<LineRow>) => {
    setLines((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);

  const removeLine = (id: string) => {
    setLines((prev) => (prev.length > 1 ? prev.filter((row) => row.id !== id) : prev));
  };

  const hasManualLines = lines.some((row) => row.description.trim().length > 0);
  const canUseJournal = lookup?.found === true || identifier.trim().length === 12;
  const canPreview = customerName.trim().length > 0 && (hasManualLines || canUseJournal);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadTemplate = async () => {
    try {
      await apiDownload("/acts/template.xlsx", {}, "akt-shveitsariya-shablon.xlsx");
      toast.success("Шаблон Excel скачан");
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.message);
      else toast.error("Не удалось скачать шаблон");
    }
  };

  const handleDownloadExcel = async (docType: ExportDocType) => {
    if (!actDocument) return;
    try {
      await downloadDocExcel(docType, actDocument);
      toast.success(`${EXPORT_DOCS[docType].label} — Excel скачан`);
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.message);
      else toast.error("Не удалось скачать Excel");
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 no-print">
        <div>
          <h1 className="text-2xl font-bold">Акты и счета</h1>
          <p className="text-sm text-muted-foreground">
            Акт выполненных работ (Р-1), счёт-фактура и счёт на оплату · исполнитель: ТРК
            «Швейцария», ул. Алтынсарина, 20
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={handleDownloadTemplate}
          >
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Шаблон Excel
          </Button>
          {(Object.keys(EXPORT_DOCS) as ExportDocType[]).map((docType) => (
            <Button
              key={docType}
              onClick={() => exportExcelMutation.mutate(docType)}
              disabled={
                previewMutation.isPending ||
                exportExcelMutation.isPending ||
                !canPreview
              }
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              {EXPORT_DOCS[docType].label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 no-print">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" />
              Заказчик
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Тип заказчика</Label>
              <Select
                value={recipientType}
                onValueChange={(v) => {
                  setRecipientType(v as RecipientType);
                  setIdentifier("");
                  setLookup(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="individual">Физическое лицо (ИИН)</SelectItem>
                  <SelectItem value="organization">Организация (БИН)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{recipientType === "individual" ? "ИИН" : "БИН"}</Label>
              <div className="flex gap-2">
                <Input
                  value={identifier}
                  onChange={(e) =>
                    setIdentifier(e.target.value.replace(/\D/g, "").slice(0, 12))
                  }
                  placeholder="12 цифр (необязательно)"
                  maxLength={12}
                />
                <Button
                  variant="outline"
                  onClick={handleSearch}
                  disabled={searchMutation.isPending || identifier.trim().length !== 12}
                >
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {lookup?.found && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">
                Найден: <strong>{lookup.full_name}</strong>
                {lookup.phone && ` · ${lookup.phone}`}
              </div>
            )}

            <div className="space-y-2">
              <Label>
                {recipientType === "individual" ? "ФИО заказчика" : "Наименование организации"}
              </Label>
              <Input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Полное наименование"
              />
            </div>

            <div className="space-y-2">
              <Label>Адрес заказчика</Label>
              <Input
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                placeholder="Республика Казахстан, город, улица, дом"
              />
            </div>

            <div className="space-y-2">
              <Label>IBAN покупателя</Label>
              <Input
                value={customerIban}
                onChange={(e) => setCustomerIban(e.target.value)}
                placeholder='KZ… в АО «Банк», БИК …'
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Реквизиты акта</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="font-medium">Исполнитель (автоматически)</p>
              <p>ИП Торгово-развлекательный комплекс «Швейцария» Бектурова Ж.К.</p>
              <p>г. Текели, ул. Ы. Алтынсарина 20</p>
              <p>р/с KZ616010311000181781 в АО «Народный Банк Казахстана», БИК HSBKKZKX</p>
              <p>БИН: {settings?.hotel_bin || "571031400540"}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Номер документа</Label>
                <Input
                  value={nextNumber?.next_number ?? ""}
                  readOnly
                  className="bg-muted"
                  placeholder="…"
                />
                <p className="text-xs text-muted-foreground">Порядковый номер присваивается автоматически</p>
              </div>
              <div className="space-y-2">
                <Label>Дата составления</Label>
                <Input
                  type="date"
                  value={actDate}
                  onChange={(e) => setActDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Договор (контракт)</Label>
              <Input
                value={contractNumber}
                onChange={(e) => setContractNumber(e.target.value)}
                placeholder="Договор №88 от 01.05.2026"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Период журнала с</Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Период журнала по</Label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={handleDownloadTemplate}
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Скачать шаблон Excel
            </Button>

            <Button
              variant="outline"
              className="w-full"
              onClick={() => journalMutation.mutate()}
              disabled={journalMutation.isPending}
            >
              Заполнить строки из журнала
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 no-print">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Услуги</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Если оставить строки пустыми, документ автоматически заполнится из журнала
              за выбранный период (по найденному заказчику)
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={addLine}>
            <Plus className="mr-1 h-4 w-4" />
            Строка
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {lines.map((row, index) => (
            <div
              key={row.id}
              className="grid gap-2 rounded-lg border p-3 md:grid-cols-12 md:items-end"
            >
              <div className="md:col-span-1">
                <Label className="text-xs">№</Label>
                <p className="py-2 text-sm font-medium">{index + 1}</p>
              </div>
              <div className="md:col-span-4">
                <Label className="text-xs">Вид услуги</Label>
                <Input
                  value={row.description}
                  onChange={(e) => updateLine(row.id, { description: e.target.value })}
                  placeholder="Услуги проживания в гостинице"
                />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">Дата / период</Label>
                <Input
                  value={row.service_date}
                  onChange={(e) => updateLine(row.id, { service_date: e.target.value })}
                  placeholder="01.05.2026-31.05.2026"
                />
              </div>
              <div className="md:col-span-1">
                <Label className="text-xs">Ед.</Label>
                <Input
                  value={row.unit}
                  onChange={(e) => updateLine(row.id, { unit: e.target.value })}
                />
              </div>
              <div className="md:col-span-1">
                <Label className="text-xs">Кол-во</Label>
                <Input
                  value={row.quantity}
                  onChange={(e) => updateLine(row.id, { quantity: e.target.value })}
                />
              </div>
              <div className="md:col-span-1">
                <Label className="text-xs">Цена</Label>
                <Input
                  value={row.unit_price}
                  onChange={(e) => updateLine(row.id, { unit_price: e.target.value })}
                />
              </div>
              <div className="md:col-span-1">
                <Label className="text-xs">Сумма</Label>
                <p className="py-2 text-sm font-medium">{lineAmount(row).toLocaleString("ru-KZ")} ₸</p>
              </div>
              <div className="flex md:col-span-1 md:justify-end">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeLine(row.id)}
                  disabled={lines.length === 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Button
              className="w-full"
              onClick={() => previewMutation.mutate()}
              disabled={
                previewMutation.isPending ||
                exportExcelMutation.isPending ||
                !canPreview
              }
            >
              Сформировать акт
            </Button>
            {(Object.keys(EXPORT_DOCS) as ExportDocType[]).map((docType) => (
              <Button
                key={docType}
                variant="outline"
                className="w-full"
                onClick={() => exportExcelMutation.mutate(docType)}
                disabled={
                  previewMutation.isPending ||
                  exportExcelMutation.isPending ||
                  !canPreview
                }
              >
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                {EXPORT_DOCS[docType].label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {actDocument && (
        <div className="mt-8">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 no-print">
            <div className="flex flex-wrap gap-2">
              <Button
                variant={printView === "act" ? "default" : "outline"}
                onClick={() => setPrintView("act")}
              >
                Превью: Акт
              </Button>
              <Button
                variant={printView === "invoice" ? "default" : "outline"}
                onClick={() => setPrintView("invoice")}
              >
                Превью: Счёт-фактура
              </Button>
              <Button
                variant={printView === "payment" ? "default" : "outline"}
                onClick={() => setPrintView("payment")}
              >
                Превью: Счёт на оплату
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(EXPORT_DOCS) as ExportDocType[]).map((docType) => (
                <Button
                  key={docType}
                  variant="outline"
                  onClick={() => void handleDownloadExcel(docType)}
                >
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  {EXPORT_DOCS[docType].label}
                </Button>
              ))}
              <Button onClick={handlePrint}>
                <Printer className="mr-2 h-4 w-4" />
                Печать / PDF
              </Button>
            </div>
          </div>
          {printView === "act" ? (
            <ActDocumentPrint
              document={actDocument}
              hotelDirector={settings?.hotel_director}
            />
          ) : printView === "invoice" ? (
            <InvoiceDocumentPrint
              document={actDocument}
              hotelBin={settings?.hotel_bin}
              hotelDirector={settings?.hotel_director}
            />
          ) : (
            <PaymentInvoiceDocumentPrint
              document={actDocument}
              hotelBin={settings?.hotel_bin}
              hotelDirector={settings?.hotel_director}
            />
          )}
        </div>
      )}
    </div>
  );
}
