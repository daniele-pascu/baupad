import { useEffect, useRef, useState } from 'react';
import { ActionMenu } from '../components/ActionMenu';
import { FormTemplateDialog } from '../components/FormTemplates';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { SiteNav } from '../components/SiteNav';
import { ToolIcon, ToolMark } from '../components/ToolIcon';
import { confirmDialog, promptDialog, showError, toast } from '../components/ui';
import { deleteFormTemplate, getFormFile, listFormEntries, listFormTemplates, putFormFile, saveFormTemplate } from '../lib/db';
import { analyzeForm, isCustomTemplate, templateFileId, type FormPage, type FormTemplate } from '../lib/form-template';
import { fieldsFromDetection, readingOrder, typeLabel } from '../lib/forms';
import { uuid } from '../lib/ids';
import { usePageTitle } from '../lib/page-title';
import { REPORT_TYPES, typeInfo } from '../lib/reports';
import { navigate, paths } from '../lib/router';
import { canEditSites } from '../lib/sites';
import { useSession } from '../lib/use-session';
import type { ReportType } from '../lib/types';
import { ACCENT } from './ReportsPage';

/**
 * Formularvorlagen der Firma (Berichte & Formulare → Vorlagen): PDF hochladen, Felder einrichten, umbenennen,
 * kopieren, löschen. Zwei Arten: freie Firmenformulare (eigene Felder, werden im Projekt ausgefüllt) und
 * Firmenformulare für BauPad-Berichte (Regieliste, Bautagesbericht – automatisch befüllt).
 */

/** PDF lesen: erste Seite als Text/Linien (für die Erkennung) */
async function readPdf(file: File): Promise<{ pdf: ArrayBuffer; page: FormPage }> {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error('Bitte das Formular als PDF hochladen.');
  const pdf = await file.arrayBuffer();
  const { openPdf, closePdf, readFormPage } = await import('../lib/pdf');
  const doc = await openPdf(pdf);
  const page = await readFormPage(await doc.getPage(1));
  await closePdf(doc);
  return { pdf, page };
}

function guessReportType(page: FormPage, fileName: string): ReportType {
  const text = `${[...page.texts].sort((a, b) => b.h - a.h).slice(0, 3).map((t) => t.str).join(' ')} ${fileName}`.toLowerCase();
  if (/wochenbericht|bauwoche/.test(text)) return 'woche';
  if (/tagesbericht|tagebuch|tagesrapport/.test(text)) return 'tag';
  return 'regie';
}

export function FormTemplatesPage() {
  usePageTitle('Formularvorlagen – BauPad');
  const session = useSession();
  const mayManage = canEditSites(session);
  const [list, setList] = useState<FormTemplate[] | null>(null);
  const [counts, setCounts] = useState<Map<string, number>>(() => new Map());
  const [upload, setUpload] = useState<{ pdf: ArrayBuffer; page: FormPage; fileName: string } | null>(null);
  const [reportDraft, setReportDraft] = useState<{ t: FormTemplate; pdf: ArrayBuffer } | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const replaceFor = useRef<FormTemplate | null>(null);

  const reload = () =>
    Promise.all([listFormTemplates(), listFormEntries()])
      .then(([t, e]) => {
        setList(t);
        const m = new Map<string, number>();
        for (const x of e) m.set(x.templateId, (m.get(x.templateId) ?? 0) + 1);
        setCounts(m);
      })
      .catch((e) => showError(e, 'Vorlagen konnten nicht geladen werden'));
  useEffect(() => {
    void reload();
  }, []);

  const run = (fn: () => Promise<void>) => fn().catch((e) => showError(e, 'Das hat nicht geklappt'));

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const { pdf, page } = await readPdf(file);
      const target = replaceFor.current;
      replaceFor.current = null;
      if (target) {
        // Vorlage bearbeiten: neues PDF, Felder bleiben; vorhandene Formulare behalten die alte Datei
        const fileId = uuid();
        await putFormFile(fileId, pdf);
        await saveFormTemplate({ ...target, fileId, fileName: file.name, version: (target.version ?? 1) + 1, updatedAt: Date.now() });
        toast('PDF der Vorlage ersetzt – bitte die Felder prüfen.', 'success');
        navigate(paths.formTemplate(target.id));
        return;
      }
      setUpload({ pdf, page, fileName: file.name });
    } catch (e) {
      showError(e, 'Formular konnte nicht gelesen werden');
    } finally {
      setBusy(false);
    }
  };

  /** freies Firmenformular anlegen: Felder aus der Erkennung vorschlagen, dann zum Editor */
  const createCustom = (name: string, suggest: boolean) =>
    run(async () => {
      if (!upload) return;
      const now = Date.now();
      const layout = analyzeForm(upload.page, 'tag');
      const fields = suggest ? fieldsFromDetection(layout) : [];
      const t: FormTemplate = {
        id: uuid(),
        type: 'regie',
        name: name.trim() || upload.fileName.replace(/\.pdf$/i, ''),
        fileName: upload.fileName,
        layout: { width: layout.width, height: layout.height, fields: [], table: null },
        kind: 'custom',
        fields,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      t.fileId = t.id;
      await saveFormTemplate(t, upload.pdf);
      setUpload(null);
      toast(fields.length ? `${fields.length} Felder vorgeschlagen – bitte prüfen.` : 'Vorlage angelegt – jetzt die Felder einrichten.', 'success');
      navigate(paths.formTemplate(t.id));
    });

  /** Firmenformular für einen BauPad-Bericht: bisheriger Weg (Erkennung + Zuordnung prüfen) */
  const createReportForm = () => {
    if (!upload) return;
    const type = guessReportType(upload.page, upload.fileName);
    const now = Date.now();
    setReportDraft({ t: { id: uuid(), type, name: upload.fileName.replace(/\.pdf$/i, ''), fileName: upload.fileName, layout: analyzeForm(upload.page, type), createdAt: now, updatedAt: now }, pdf: upload.pdf });
    setUpload(null);
  };

  const rename = (t: FormTemplate) =>
    run(async () => {
      const name = await promptDialog({ title: 'Vorlage umbenennen', label: 'Name der Vorlage', value: t.name });
      if (name === null || !name.trim()) return;
      await saveFormTemplate({ ...t, name: name.trim(), updatedAt: Date.now() });
      await reload();
    });
  const copy = (t: FormTemplate) =>
    run(async () => {
      const pdf = await getFormFile(templateFileId(t));
      if (!pdf) throw new Error('Die PDF-Datei der Vorlage fehlt auf diesem Gerät.');
      const now = Date.now();
      const c: FormTemplate = { ...t, id: uuid(), name: `${t.name} (Kopie)`, version: 1, createdAt: now, updatedAt: now, fields: t.fields?.map((f) => ({ ...f, id: uuid() })) };
      c.fileId = c.id;
      await saveFormTemplate(c, pdf);
      toast('Kopie angelegt.', 'success');
      await reload();
    });
  const remove = (t: FormTemplate) =>
    run(async () => {
      const n = counts.get(t.id) ?? 0;
      const ok = await confirmDialog({
        title: 'Vorlage löschen?',
        message: (
          <>
            <p>
              „{t.name}“ wird gelöscht.{n ? ` ${n} ausgefüllte ${n === 1 ? 'Formular bleibt' : 'Formulare bleiben'} erhalten und ${n === 1 ? 'kann' : 'können'} weiter als PDF ausgegeben werden.` : ''}
            </p>
            <p className="muted small">Neue Formulare mit dieser Vorlage sind danach nicht mehr möglich.</p>
          </>
        ),
        confirmLabel: 'Löschen',
        danger: true,
      });
      if (!ok) return;
      await deleteFormTemplate(t.id);
      toast('Vorlage gelöscht.', 'success');
      await reload();
    });
  const edit = (t: FormTemplate) =>
    run(async () => {
      if (isCustomTemplate(t)) return navigate(paths.formTemplate(t.id));
      const pdf = await getFormFile(templateFileId(t));
      if (!pdf) throw new Error('PDF-Datei fehlt auf diesem Gerät – bitte neu hochladen.');
      setReportDraft({ t, pdf });
    });

  const custom = (list ?? []).filter(isCustomTemplate).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const reportForms = (list ?? []).filter((t) => !isCustomTemplate(t));

  return (
    <>
      <SiteNav />
      <div className="page reports-page form-templates-page" style={ACCENT}>
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={paths.reports()} className="icon-link" aria-label="Zur Übersicht" title="Zur Übersicht" data-testid="to-reports">
              <Icon name="back" />
            </a>
            <ToolMark name="reports" />
            <div>
              <h1 data-testid="form-templates-title">Formularvorlagen</h1>
              <span className="muted small">Eigene PDF-Formulare der Firma – Felder selbst einrichten, im Projekt ausfüllen</span>
            </div>
          </div>
          {mayManage && (
            <div className="report-actions">
              <button type="button" className="btn btn-primary" onClick={() => input.current?.click()} disabled={busy} data-testid="form-template-pick">
                <Icon name="plus" size={16} /> Neues Formular hinzufügen
              </button>
            </div>
          )}
        </header>
        <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => void pick(e.target.files?.[0]).finally(() => (e.target.value = ''))} data-testid="form-template-input" />

        {list && list.length === 0 && (
          <div className="crew-setup" data-testid="form-templates-empty">
            <span className="tile-icon">
              <ToolIcon name="reports" size={22} />
            </span>
            <div>
              <strong>Noch keine Vorlage</strong>
              <p className="muted small">
                {mayManage
                  ? 'Regieliste, Stundenzettel, Materialliste oder ein anderes Formular der Firma als PDF hochladen. Danach jeden Kasten benennen und festlegen, was dort eingetragen wird – die Vorlage lässt sich dann in jedem Projekt digital ausfüllen.'
                  : 'Vorlagen legen Admin oder Büro an.'}
              </p>
            </div>
            {mayManage && (
              <button type="button" className="btn btn-primary" onClick={() => input.current?.click()} disabled={busy}>
                Neues Formular hinzufügen
              </button>
            )}
          </div>
        )}

        {custom.length > 0 && (
          <section className="report-section" data-testid="form-templates-custom">
            <header className="report-section-head">
              <h2>Firmenformulare</h2>
              <span className="muted small">{custom.length}</span>
            </header>
            <ul className="form-template-cards">
              {custom.map((t) => {
                const fields = readingOrder(t.fields ?? []);
                const n = counts.get(t.id) ?? 0;
                return (
                  <li key={t.id} className="form-template-card" data-testid="form-template-row" data-name={t.name}>
                    <div className="form-template-main">
                      <strong>{t.name}</strong>
                      <span className="muted small">
                        {fields.length} {fields.length === 1 ? 'Feld' : 'Felder'} · {n} {n === 1 ? 'Formular' : 'Formulare'} ausgefüllt
                      </span>
                      {fields.length > 0 ? (
                        <ul className="form-field-chips" data-testid="form-template-fields">
                          {fields.map((f) => (
                            <li key={f.id} className={`form-field-chip${f.required ? ' req' : ''}`} title={`${typeLabel(f.type)}${f.hint ? ` – ${f.hint}` : ''}`}>
                              {f.name}
                              {f.required && <span aria-label="Pflichtfeld"> *</span>}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="small text-warn">Noch keine Felder eingerichtet.</span>
                      )}
                    </div>
                    <div className="row gap form-template-actions">
                      {mayManage && (
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => void edit(t)} data-testid="form-template-edit">
                          <Icon name="edit" size={16} /> Felder bearbeiten
                        </button>
                      )}
                      {mayManage && (
                        <ActionMenu
                          label={`Aktionen für ${t.name}`}
                          testId="form-template-actions"
                          actions={[
                            { label: 'Umbenennen', icon: 'edit', onSelect: () => rename(t), testId: 'form-template-rename' },
                            {
                              label: 'Vorlage bearbeiten (neues PDF)',
                              icon: 'upload',
                              onSelect: () => {
                                replaceFor.current = t;
                                input.current?.click();
                              },
                              testId: 'form-template-replace',
                            },
                            { label: 'Kopieren', icon: 'copy', onSelect: () => copy(t), testId: 'form-template-copy' },
                            { label: 'Löschen', icon: 'trash', danger: true, onSelect: () => remove(t), testId: 'form-template-remove' },
                          ]}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {reportForms.length > 0 && (
          <section className="report-section" data-testid="form-templates-report">
            <header className="report-section-head">
              <h2>Firmenformulare für BauPad-Berichte</h2>
              <span className="muted small">{reportForms.length}</span>
            </header>
            <p className="muted small">Regieliste und Bautagesbericht aus BauPad werden beim PDF automatisch in diese Formulare geschrieben.</p>
            <ul className="form-template-cards">
              {reportForms.map((t) => (
                <li key={t.id} className="form-template-card" data-testid="form-template-row" data-name={t.name}>
                  <div className="form-template-main">
                    <strong>{t.name}</strong>
                    <span className="muted small">
                      {typeInfo(t.type).label} · {t.layout.fields.filter((f) => f.key).length} Felder zugeordnet{t.layout.table ? ` · Tabelle ${t.layout.table.rows} Zeilen` : ''}
                    </span>
                  </div>
                  {mayManage && (
                    <div className="row gap form-template-actions">
                      <button type="button" className="btn btn-sm" onClick={() => void edit(t)} data-testid="form-template-edit">
                        Zuordnung prüfen
                      </button>
                      <button type="button" className="btn btn-sm btn-danger-text" onClick={() => remove(t)} aria-label="Löschen" data-testid="form-template-remove">
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="muted small">Hinweis: Eingerichtet wird jeweils die erste Seite einer PDF.</p>
      </div>

      {upload && <NewTemplateDialog fileName={upload.fileName} onClose={() => setUpload(null)} onCustom={createCustom} onReport={createReportForm} />}
      {reportDraft && (
        <FormTemplateDialog
          template={reportDraft.t}
          pdf={reportDraft.pdf}
          onClose={() => setReportDraft(null)}
          onSaved={() => {
            setReportDraft(null);
            void reload();
          }}
        />
      )}
    </>
  );
}

/** nach dem Hochladen: Name vergeben, Art wählen */
function NewTemplateDialog({ fileName, onClose, onCustom, onReport }: { fileName: string; onClose(): void; onCustom(name: string, suggest: boolean): void; onReport(): void }) {
  const [name, setName] = useState(fileName.replace(/\.pdf$/i, ''));
  const [kind, setKind] = useState<'custom' | 'report'>('custom');
  const [suggest, setSuggest] = useState(true);
  return (
    <Modal
      title="Neues Formular"
      onClose={onClose}
      testId="form-new-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => (kind === 'custom' ? onCustom(name, suggest) : onReport())} disabled={!name.trim()} data-testid="form-new-create">
            {kind === 'custom' ? 'Weiter zu den Feldern' : 'Weiter zur Zuordnung'}
          </button>
        </>
      }
    >
      <div className="stack-fields">
        <label className="field">
          <span>Formularname *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Regieliste Firma Muster" data-autofocus data-testid="form-new-name" />
        </label>
        <div className="report-type-choice" role="radiogroup" aria-label="Art der Vorlage">
          <button type="button" role="radio" aria-checked={kind === 'custom'} className={`report-type-card${kind === 'custom' ? ' active' : ''}`} onClick={() => setKind('custom')} data-testid="form-new-kind-custom">
            <strong>Eigene Felder einrichten</strong>
            <span className="muted small">Jeden Kasten selbst benennen (Text, Datum, Mitarbeiter, Projekt …) und im Projekt digital ausfüllen.</span>
          </button>
          <button type="button" role="radio" aria-checked={kind === 'report'} className={`report-type-card${kind === 'report' ? ' active' : ''}`} onClick={() => setKind('report')} data-testid="form-new-kind-report">
            <strong>Für einen BauPad-Bericht</strong>
            <span className="muted small">{REPORT_TYPES.map((t) => t.label).join(', ')}: BauPad erkennt die Felder und füllt sie beim PDF automatisch.</span>
          </button>
        </div>
        {kind === 'custom' && (
          <label className="check-row">
            <input type="checkbox" checked={suggest} onChange={(e) => setSuggest(e.target.checked)} data-testid="form-new-suggest" />
            <span>Felder aus Beschriftungen und Linien der PDF vorschlagen (danach prüfen)</span>
          </label>
        )}
      </div>
    </Modal>
  );
}
