/**
 * EtlSyncModal — Three-stage ETLAB screenshot sync modal.
 *
 * Stage 1: Select screenshots (file input or drag-drop) + instant-test button.
 * Stage 2: OCR scanning progress bar.
 * Stage 3: Editable Overall Header, per-card confirmation table (with live
 *          recomputed checksum + "+ Add Card Manually"), and collapsible
 *          "View Raw OCR Text (Debug)" panel with Copy button.
 */

import { useState, useCallback, useRef, useMemo } from "react";
import {
  X,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Zap,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  Copy,
  Check,
} from "lucide-react";
import { mergeAndValidateOcrExtracts } from "@/engine/ocrParser";
import type { MultiOcrParseResult, ParsedEtlabCard } from "@/engine/ocrParser";
import { validateEtlExtract } from "@/engine/checksum";
import type { ChecksumResult, EtlabOverallHeader } from "@/engine/types2";
import { runMultiImageOcr } from "@/utils/ocrRunner";
import type { OcrProgress } from "@/utils/ocrRunner";
import { previewEtlabSync, commitEtlabSync } from "@/db/syncActions";
import type { SyncPreviewItem } from "@/db/syncActions";
import { SAMPLE_S5_OCR_TEXT } from "@/utils/sampleOcr";

// ---------------------------------------------------------------------------
// Props & internal types
// ---------------------------------------------------------------------------

interface EtlSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface EditableCard extends ParsedEtlabCard {
  _uid: string;
  _deleted?: boolean;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

let uidCounter = 0;
function nextUid(): string {
  uidCounter += 1;
  return `card-${uidCounter}`;
}

function toEditableCards(cards: ParsedEtlabCard[]): EditableCard[] {
  return cards.map((c) => ({ ...c, _uid: nextUid() }));
}

function toCleanCard(card: EditableCard): ParsedEtlabCard {
  const code = card.code.trim().toUpperCase();
  const name = card.name.trim() || code;
  const clean: ParsedEtlabCard = {
    subjectId: code,
    code,
    slotLetter: card.slotLetter.trim().toUpperCase(),
    name,
    kind: card.kind,
    hoursPerSession: card.kind === "lab" ? Math.max(1, card.hoursPerSession || 3) : 1,
    attended: card.attended,
    total: card.total,
    missed: card.missed,
    leave: card.leave,
    dutyLeave: card.dutyLeave,
    displayedPercent:
      card.total > 0
        ? Math.floor((card.attended * 200 + card.total) / (2 * card.total))
        : 0,
  };
  if (card.creditWise !== undefined) {
    clean.creditWise = card.creditWise;
  }
  return clean;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ChecksumBanner({
  checksum,
  duplicatesRemoved,
  warnings,
}: {
  checksum: ChecksumResult | null;
  duplicatesRemoved: number;
  warnings: string[];
}) {
  return (
    <div className="space-y-2">
      {/* Checksum */}
      {checksum ? (
        checksum.valid ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-900/40 text-green-300 text-sm">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Checksum verified — all card totals match ETLAB header
          </div>
        ) : (
          <div className="space-y-1">
            {checksum.headerMismatch && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-900/40 text-amber-300 text-sm">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {checksum.headerMismatch.missingTotal !== 0 ||
                checksum.headerMismatch.missingAttended !== 0 ? (
                  <span>
                    Header delta: {checksum.headerMismatch.missingAttended >= 0 ? "+" : ""}
                    {checksum.headerMismatch.missingAttended} attended /{" "}
                    {checksum.headerMismatch.missingTotal >= 0 ? "+" : ""}
                    {checksum.headerMismatch.missingTotal} total hrs — possible cut-off card
                  </span>
                ) : null}
              </div>
            )}
            {checksum.cardErrors.length > 0 && (
              <div className="px-3 py-1.5 rounded-lg bg-red-900/30 text-red-300 text-xs space-y-0.5">
                {checksum.cardErrors.map((e, i) => (
                  <p key={i}>
                    ✕ {e.subjectId || "Card"}: {e.detail}
                  </p>
                ))}
              </div>
            )}
          </div>
        )
      ) : (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 text-gray-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          No overall header set — enter ETLAB totals below to verify checksum
        </div>
      )}

      {/* Duplicates */}
      {duplicatesRemoved > 0 && (
        <div className="px-3 py-1.5 rounded-lg bg-blue-900/30 text-blue-300 text-xs">
          Duplicates removed: {duplicatesRemoved} (overlapping screenshot cards merged)
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 text-xs space-y-0.5">
          {warnings.map((w, i) => (
            <p key={i}>⚠ {w}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EtlSyncModal({ isOpen, onClose }: EtlSyncModalProps) {
  const [stage, setStage] = useState<1 | 2 | 3>(1);
  const [files, setFiles] = useState<File[]>([]);
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<MultiOcrParseResult | null>(null);
  const [overallHeader, setOverallHeader] = useState<EtlabOverallHeader>({
    attended: 0,
    total: 0,
  });
  const [editableCards, setEditableCards] = useState<EditableCard[]>([]);
  const [previewItems, setPreviewItems] = useState<SyncPreviewItem[]>([]);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showRawDebug, setShowRawDebug] = useState(false);
  const [copiedRaw, setCopiedRaw] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------------------------
  // Live checksum over current editable header + active cards
  // ---------------------------------------------------------------------------
  const activeCards = useMemo(
    () => editableCards.filter((c) => !c._deleted).map(toCleanCard),
    [editableCards]
  );

  const liveChecksum = useMemo<ChecksumResult | null>(() => {
    if (overallHeader.total <= 0) return null;
    return validateEtlExtract(overallHeader, activeCards);
  }, [overallHeader, activeCards]);

  // ---------------------------------------------------------------------------
  // Reset / close
  // ---------------------------------------------------------------------------
  function handleClose() {
    setStage(1);
    setFiles([]);
    setOcrProgress(null);
    setOcrError(null);
    setOcrResult(null);
    setOverallHeader({ attended: 0, total: 0 });
    setEditableCards([]);
    setPreviewItems([]);
    setCommitting(false);
    setCommitError(null);
    setShowRawDebug(false);
    setCopiedRaw(false);
    onClose();
  }

  // ---------------------------------------------------------------------------
  // File selection
  // ---------------------------------------------------------------------------
  function acceptFiles(incoming: File[]) {
    const images = incoming.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setFiles((prev) => [...prev, ...images].slice(0, 4));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) acceptFiles(Array.from(e.target.files));
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    acceptFiles(Array.from(e.dataTransfer.files));
  }, []);

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  // ---------------------------------------------------------------------------
  // Instant test (no OCR — directly parses sample text)
  // ---------------------------------------------------------------------------
  async function handleInstantTest() {
    const result = mergeAndValidateOcrExtracts([SAMPLE_S5_OCR_TEXT]);
    await enterStage3(result);
  }

  // ---------------------------------------------------------------------------
  // Real OCR scan
  // ---------------------------------------------------------------------------
  async function handleScan() {
    setOcrError(null);
    setStage(2);
    setOcrProgress({
      imageIndex: 1,
      totalImages: files.length,
      progress: 0,
      status: `Scanning screenshot 1 of ${files.length}…`,
    });

    try {
      const result = await runMultiImageOcr(files, (info) => setOcrProgress(info));
      await enterStage3(result);
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : "OCR failed. Please try again.");
      setStage(1);
    }
  }

  // ---------------------------------------------------------------------------
  // Enter stage 3: load preview data
  // ---------------------------------------------------------------------------
  async function enterStage3(result: MultiOcrParseResult) {
    setOcrResult(result);
    setOverallHeader(
      result.overallHeader
        ? { ...result.overallHeader }
        : { attended: 0, total: 0 }
    );
    setEditableCards(toEditableCards(result.cards));
    setShowRawDebug(false);
    setCopiedRaw(false);

    try {
      const preview = await previewEtlabSync(result.cards, todayStr());
      setPreviewItems(preview);
    } catch {
      setPreviewItems(result.cards.map((c) => ({ card: c, isNew: false })));
    }

    setStage(3);
  }

  // ---------------------------------------------------------------------------
  // Editable card & manual add helpers
  // ---------------------------------------------------------------------------
  function updateCard<K extends keyof EditableCard>(
    uid: string,
    field: K,
    value: EditableCard[K]
  ) {
    setEditableCards((prev) =>
      prev.map((c) => {
        if (c._uid !== uid) return c;
        const next: EditableCard = { ...c, [field]: value };
        if (field === "code" && typeof value === "string") {
          next.subjectId = value.toUpperCase();
        }
        if (field === "kind") {
          next.hoursPerSession = value === "lab" ? 3 : 1;
        }
        return next;
      })
    );
  }

  function deleteCard(uid: string) {
    setEditableCards((prev) =>
      prev.map((c) => (c._uid === uid ? { ...c, _deleted: true } : c))
    );
  }

  function addManualCard() {
    const newCard: EditableCard = {
      _uid: nextUid(),
      subjectId: "",
      code: "",
      slotLetter: "",
      name: "",
      kind: "theory",
      hoursPerSession: 1,
      attended: 0,
      total: 0,
      missed: 0,
      leave: 0,
      dutyLeave: 0,
      displayedPercent: 0,
    };
    setEditableCards((prev) => [...prev, newCard]);
  }

  // ---------------------------------------------------------------------------
  // Copy raw debug OCR text
  // ---------------------------------------------------------------------------
  async function handleCopyRawText() {
    const texts = ocrResult?.rawTexts ?? [];
    if (texts.length === 0) return;
    const joined =
      texts.length === 1
        ? texts[0]!
        : texts.map((t, i) => `--- Screenshot ${i + 1} ---\n${t}`).join("\n\n");
    try {
      await navigator.clipboard.writeText(joined);
      setCopiedRaw(true);
      setTimeout(() => setCopiedRaw(false), 2000);
    } catch {
      // Clipboard API unavailable in non-HTTPS contexts
    }
  }

  // ---------------------------------------------------------------------------
  // Commit
  // ---------------------------------------------------------------------------
  const visibleCards = editableCards.filter((c) => !c._deleted);
  const hasBlankCode = visibleCards.some((c) => c.code.trim().length === 0);

  async function handleCommit() {
    if (visibleCards.length === 0 || hasBlankCode) return;
    setCommitting(true);
    setCommitError(null);
    const toSync = visibleCards.map(toCleanCard);
    try {
      await commitEtlabSync(toSync, todayStr());
      handleClose();
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : "Sync failed.");
      setCommitting(false);
    }
  }

  function getPreviewItem(code: string): SyncPreviewItem | undefined {
    if (!code) return undefined;
    return previewItems.find((p) => p.card.code === code.toUpperCase());
  }

  if (!isOpen) return null;

  const rawTexts = ocrResult?.rawTexts ?? [];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full sm:max-w-2xl max-h-[90dvh] flex flex-col bg-gray-900 sm:rounded-2xl rounded-t-2xl overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2">
            {stage === 3 && (
              <button
                onClick={() => setStage(1)}
                className="p-1 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <h2 className="font-semibold text-sm text-white">
              {stage === 1
                ? "Sync ETLAB"
                : stage === 2
                ? "Scanning…"
                : "Review & Confirm"}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* ----------------------------------------------------------------
              STAGE 1 — Select screenshots
          ---------------------------------------------------------------- */}
          {stage === 1 && (
            <div className="p-4 space-y-4">
              <p className="text-xs text-gray-400">
                Take 1–4 screenshots of ETLAB's{" "}
                <strong className="text-gray-200">By Course</strong> page
                (overlapping is fine — duplicates are merged automatically).
              </p>

              {/* Drag-drop zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl p-6 cursor-pointer transition ${
                  dragging
                    ? "border-indigo-400 bg-indigo-900/20"
                    : "border-gray-700 hover:border-gray-500 bg-gray-800/50"
                }`}
              >
                <Upload className="w-8 h-8 text-gray-500" />
                <p className="text-sm text-gray-400">
                  Tap to select or drag screenshots here
                </p>
                <p className="text-xs text-gray-600">
                  Max 4 images · PNG, JPG, WEBP
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  onChange={handleFileChange}
                />
              </div>

              {/* Selected files list */}
              {files.length > 0 && (
                <ul className="space-y-1">
                  {files.map((f, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2 text-sm"
                    >
                      <span className="text-gray-200 truncate max-w-[80%]">
                        {f.name}
                      </span>
                      <button
                        onClick={() => removeFile(i)}
                        className="text-gray-500 hover:text-red-400 transition shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* Error from last scan */}
              {ocrError && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-900/40 text-red-300 text-sm">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {ocrError}
                </div>
              )}

              {/* Instant test button */}
              <button
                onClick={handleInstantTest}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition"
              >
                <Zap className="w-4 h-4 text-yellow-400" />
                Load Sample S5 Data (Instant Test)
              </button>
            </div>
          )}

          {/* ----------------------------------------------------------------
              STAGE 2 — Progress
          ---------------------------------------------------------------- */}
          {stage === 2 && (
            <div className="p-6 flex flex-col items-center gap-4">
              <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
              <p className="text-sm text-gray-300">
                {ocrProgress?.status ?? "Initializing Tesseract…"}
              </p>

              {/* Progress bar */}
              <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-indigo-500 transition-all duration-300"
                  style={{
                    width: `${((ocrProgress?.progress ?? 0) * 100).toFixed(0)}%`,
                  }}
                />
              </div>

              <p className="text-xs text-gray-500">
                Screenshot {ocrProgress?.imageIndex ?? 1} of{" "}
                {ocrProgress?.totalImages ?? files.length}
              </p>
            </div>
          )}

          {/* ----------------------------------------------------------------
              STAGE 3 — Editable confirmation table
          ---------------------------------------------------------------- */}
          {stage === 3 && ocrResult && (
            <div className="p-4 space-y-4">
              {/* Live Checksum banner */}
              <ChecksumBanner
                checksum={liveChecksum}
                duplicatesRemoved={ocrResult.duplicatesRemoved}
                warnings={ocrResult.warnings}
              />

              {/* Inline Editable Overall Header */}
              <div className="bg-gray-800/80 border border-gray-800 rounded-xl px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-gray-200">
                    ETLAB Overall Header
                  </p>
                  <p className="text-[11px] text-gray-500">
                    Used as checksum against subject totals
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-sm">
                  <input
                    type="number"
                    min={0}
                    aria-label="Overall attended hours"
                    value={overallHeader.attended}
                    onChange={(e) =>
                      setOverallHeader((prev) => ({
                        ...prev,
                        attended: Math.max(0, parseInt(e.target.value, 10) || 0),
                      }))
                    }
                    className="w-16 text-center bg-gray-700 text-white rounded-lg px-1.5 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <span className="text-gray-500">/</span>
                  <input
                    type="number"
                    min={0}
                    aria-label="Overall total hours"
                    value={overallHeader.total}
                    onChange={(e) =>
                      setOverallHeader((prev) => ({
                        ...prev,
                        total: Math.max(0, parseInt(e.target.value, 10) || 0),
                      }))
                    }
                    className="w-16 text-center bg-gray-700 text-white rounded-lg px-1.5 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <span className="text-xs text-gray-400">hrs</span>
                </div>
              </div>

              {/* Per-card rows */}
              <div className="space-y-3">
                {visibleCards.length === 0 && (
                  <div className="text-center py-6 bg-gray-800/40 rounded-xl border border-dashed border-gray-700 text-xs text-gray-400">
                    No subject cards extracted. Click{" "}
                    <strong className="text-gray-200">+ Add Card Manually</strong>{" "}
                    below or inspect the raw OCR text.
                  </div>
                )}

                {visibleCards.map((card) => {
                  const preview = getPreviewItem(card.code);
                  const isNew = preview?.isNew ?? false;
                  const mismatch = preview?.reconcileResult?.mismatch;

                  return (
                    <div
                      key={card._uid}
                      className="bg-gray-800 rounded-xl p-3 relative"
                    >
                      {/* Delete button */}
                      <button
                        onClick={() => deleteCard(card._uid)}
                        aria-label={`Remove ${card.code || "card"}`}
                        className="absolute top-2 right-2 text-gray-600 hover:text-red-400 transition"
                      >
                        <X className="w-4 h-4" />
                      </button>

                      {/* Header row */}
                      <div className="flex items-start gap-2 mb-2 pr-6">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <input
                              type="text"
                              placeholder="CODE (e.g. PCCST501)"
                              value={card.code}
                              onChange={(e) =>
                                updateCard(card._uid, "code", e.target.value)
                              }
                              className={`w-28 font-mono text-xs font-semibold uppercase bg-gray-700/70 text-indigo-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                                !card.code.trim() ? "ring-1 ring-amber-500/70" : ""
                              }`}
                            />
                            <input
                              type="text"
                              placeholder="Slot"
                              maxLength={2}
                              value={card.slotLetter}
                              onChange={(e) =>
                                updateCard(
                                  card._uid,
                                  "slotLetter",
                                  e.target.value
                                )
                              }
                              className="w-10 text-center text-xs uppercase bg-gray-700/50 text-gray-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                            <select
                              value={card.kind}
                              onChange={(e) =>
                                updateCard(
                                  card._uid,
                                  "kind",
                                  e.target.value as "theory" | "lab"
                                )
                              }
                              className="text-xs capitalize text-gray-300 bg-gray-700 px-1.5 py-0.5 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            >
                              <option value="theory">Theory</option>
                              <option value="lab">Lab</option>
                            </select>
                            {isNew && (
                              <span className="text-xs text-green-400 bg-green-900/40 px-1.5 py-0.5 rounded">
                                New Subject
                              </span>
                            )}
                            {mismatch && (
                              <span className="text-xs text-amber-400 bg-amber-900/40 px-1.5 py-0.5 rounded">
                                Mismatch: logged {mismatch.expectedMissed}h
                                missed vs ETLAB {mismatch.etlabMissed}h
                              </span>
                            )}
                          </div>
                          {/* Editable name */}
                          <input
                            type="text"
                            placeholder="Subject name"
                            value={card.name}
                            onChange={(e) =>
                              updateCard(card._uid, "name", e.target.value)
                            }
                            className="mt-1.5 w-full bg-transparent text-sm text-gray-200 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded px-1 -ml-1"
                          />
                        </div>
                      </div>

                      {/* Numbers row */}
                      <div className="grid grid-cols-4 gap-2 text-center">
                        {(
                          [
                            { label: "Attended", field: "attended" as const },
                            { label: "Total", field: "total" as const },
                            { label: "Missed", field: "missed" as const },
                            {
                              label: "Duty Leave",
                              field: "dutyLeave" as const,
                            },
                          ] as const
                        ).map(({ label, field }) => (
                          <div key={field}>
                            <p className="text-xs text-gray-500 mb-1">
                              {label}
                            </p>
                            <input
                              type="number"
                              min={0}
                              value={card[field]}
                              onChange={(e) =>
                                updateCard(
                                  card._uid,
                                  field,
                                  Math.max(
                                    0,
                                    parseInt(e.target.value, 10) || 0
                                  )
                                )
                              }
                              className="w-full text-center bg-gray-700 text-white rounded-lg px-1 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                          </div>
                        ))}
                      </div>

                      {/* ETLAB delta info */}
                      {!isNew && preview?.oldAnchor && (
                        <p className="mt-2 text-xs text-gray-500">
                          ETLAB as of ~
                          {preview.reconcileResult?.newAnchor.asOfDate ??
                            preview.oldAnchor.asOfDate}
                          {" · "}
                          {card.attended - preview.oldAnchor.attended >= 0
                            ? "+"
                            : ""}
                          {card.attended - preview.oldAnchor.attended}h attended
                          /{" "}
                          {card.total - preview.oldAnchor.total >= 0 ? "+" : ""}
                          {card.total - preview.oldAnchor.total}h total
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* + Add Card Manually button */}
              <button
                type="button"
                onClick={addManualCard}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed border-gray-700 hover:border-indigo-500 text-gray-300 hover:text-indigo-300 text-sm transition"
              >
                <Plus className="w-4 h-4" />
                Add Card Manually
              </button>

              {/* Collapsible View Raw OCR Text (Debug) */}
              <div className="border border-gray-800 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowRawDebug((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-gray-800/60 hover:bg-gray-800 text-xs text-gray-400 transition"
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    {showRawDebug ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                    View Raw OCR Text (Debug)
                  </span>
                  <span className="text-[11px] text-gray-500">
                    {rawTexts.length} {rawTexts.length === 1 ? "image" : "images"}
                  </span>
                </button>

                {showRawDebug && (
                  <div className="p-3 bg-gray-950/80 space-y-2 border-t border-gray-800">
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleCopyRawText}
                        disabled={rawTexts.length === 0}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 transition"
                      >
                        {copiedRaw ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-green-400" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            Copy Raw Text
                          </>
                        )}
                      </button>
                    </div>

                    {rawTexts.length === 0 ? (
                      <p className="text-xs text-gray-500 italic">
                        (No raw OCR text captured)
                      </p>
                    ) : (
                      <div className="max-h-48 overflow-y-auto space-y-3">
                        {rawTexts.map((txt, i) => (
                          <div key={i}>
                            {rawTexts.length > 1 && (
                              <p className="text-[11px] text-gray-500 mb-1 font-medium">
                                Screenshot {i + 1}
                              </p>
                            )}
                            <pre className="text-[11px] leading-relaxed font-mono text-gray-300 whitespace-pre-wrap break-words bg-gray-900 p-2 rounded-lg select-all">
                              {txt}
                            </pre>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Commit error */}
              {commitError && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-900/40 text-red-300 text-sm">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {commitError}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-4 py-3 border-t border-gray-800 flex gap-2">
          {stage === 1 && (
            <>
              <button
                onClick={handleClose}
                className="flex-1 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition"
              >
                Cancel
              </button>
              <button
                onClick={handleScan}
                disabled={files.length === 0}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition"
              >
                Scan Screenshots
              </button>
            </>
          )}

          {stage === 2 && (
            <button
              disabled
              className="flex-1 py-2.5 rounded-xl bg-gray-800 text-gray-500 text-sm cursor-not-allowed"
            >
              Scanning…
            </button>
          )}

          {stage === 3 && (
            <>
              <button
                onClick={() => setStage(1)}
                className="flex-1 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition"
              >
                Back
              </button>
              <button
                onClick={handleCommit}
                disabled={committing || visibleCards.length === 0 || hasBlankCode}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition flex items-center justify-center gap-2"
              >
                {committing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Syncing…
                  </>
                ) : (
                  "Confirm & Sync"
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
