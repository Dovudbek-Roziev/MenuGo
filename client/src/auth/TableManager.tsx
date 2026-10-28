import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AuthApiError } from "./api";
import { createManagedTable, fetchManagedTables, TablesApiError, updateManagedTable,
  type ManagedTable, type ManagedTables } from "./manageTablesApi";
import { createPrintableTableQr } from "./printableTableQr";
import "./manage-tables.css";

function errorText(error: unknown): string {
  if (error instanceof TablesApiError) return error.message;
  if (error instanceof AuthApiError) return error.message;
  return "Не удалось выполнить запрос. Проверьте соединение и повторите попытку.";
}

function qrErrorText(error: unknown): string {
  if (error instanceof TablesApiError || error instanceof AuthApiError) return error.message;
  return "Не удалось подготовить QR-код. Повторите попытку.";
}

function safeFileName(value: string): string {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "table";
}

export default function TableManager() {
  const editButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const [data, setData] = useState<ManagedTables | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [formError, setFormError] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selectedQrId, setSelectedQrId] = useState<string | null>(null);
  const [qr, setQr] = useState<{ id: string; url: string; dataUrl: string } | null>(null);
  const [qrError, setQrError] = useState("");

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else setLoading(true);
    setLoadError("");
    try {
      setData(await fetchManagedTables());
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectedTable = data?.tables.find((table) => table.id === selectedQrId);
  useEffect(() => {
    let cancelled = false;
    if (!selectedTable || !data) { setQr(null); setQrError(""); return; }
    setQr(null);
    setQrError("");
    void createPrintableTableQr(data.cafe.slug, selectedTable.tableCode, data.cafe.name,
      selectedTable.name, window.location.origin).then((result) => {
      if (!cancelled) setQr({ id: selectedTable.id, url: result.url, dataUrl: result.dataUrl });
    }).catch((error: unknown) => { if (!cancelled) setQrError(qrErrorText(error)); });
    return () => { cancelled = true; };
  }, [selectedTable, data]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setFormError("");
    setNotice("");
    try {
      const table = await createManagedTable(name);
      setData((current) => current && { ...current, tables: [...current.tables, table].sort((a, b) => a.name.localeCompare(b.name, "ru")) });
      setName("");
      setNotice("Стол добавлен. QR-код можно открыть и скачать ниже.");
      setSelectedQrId(table.id);
    } catch (error) { setFormError(errorText(error)); }
    finally { setCreating(false); }
  }

  function beginEdit(table: ManagedTable) {
    setEditingId(table.id);
    setEditName(table.name);
    setFormError("");
  }

  async function saveName(table: ManagedTable) {
    if (savingId) return;
    setSavingId(table.id);
    setFormError("");
    setNotice("");
    try {
      const updated = await updateManagedTable(table.id, { name: editName });
      setData((current) => current && { ...current, tables: current.tables.map((item) => item.id === updated.id ? updated : item) });
      setEditingId(null);
      requestAnimationFrame(() => editButtonRefs.current.get(updated.id)?.focus());
      setNotice("Название стола изменено.");
    } catch (error) { setFormError(errorText(error)); }
    finally { setSavingId(null); }
  }

  async function toggleActive(table: ManagedTable) {
    if (savingId) return;
    setSavingId(table.id);
    setFormError("");
    setNotice("");
    try {
      const updated = await updateManagedTable(table.id, { isActive: !table.isActive });
      setData((current) => current && { ...current, tables: current.tables.map((item) => item.id === updated.id ? updated : item) });
      setNotice(updated.isActive ? "Стол активирован. Его QR-код снова открывает меню." : "Стол выключен. Гости не смогут открыть меню по его QR-коду.");
    } catch (error) { setFormError(errorText(error)); }
    finally { setSavingId(null); }
  }

  function showQr(table: ManagedTable) {
    setSelectedQrId((current) => current === table.id ? null : table.id);
  }

  return (
    <section className="manage-tables" aria-labelledby="tables-title">
      <div className="manage-tables-heading">
        <div><p className="auth-eyebrow">СТОЛЫ И QR-КОДЫ</p><h2 id="tables-title">Столы</h2>
          <p>Создавайте столы и печатайте QR-коды, которые открывают меню именно этого кафе и стола.</p></div>
        <button className="manage-secondary-button" type="button" onClick={() => void load(true)} disabled={refreshing || loading}>
          {refreshing ? "Обновляем…" : "Обновить"}
        </button>
      </div>

      <form className="manage-table-create" onSubmit={(event) => void create(event)}>
        <label htmlFor="new-table-name">Название стола
          <input id="new-table-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={60}
            placeholder="Например, Стол 12" required autoComplete="off" />
        </label>
        <button className="manage-primary-button" type="submit" disabled={creating || !name.trim()}>
          {creating ? "Добавляем…" : "Добавить стол"}
        </button>
      </form>
      {formError && <div className="manage-message is-error" role="alert">{formError}</div>}
      {notice && <p className="manage-message is-success" role="status">{notice}</p>}
      {loadError && <div className="manage-message is-error" role="alert"><p>{loadError}</p>
        <button className="manage-link-button" type="button" onClick={() => void load(true)}>Повторить загрузку</button>
      </div>}

      {loading && <div className="manage-loading" role="status">Загружаем столы…</div>}
      {!loading && !loadError && data?.tables.length === 0 && <div className="manage-tables-empty">
        <h3>Пока нет столов</h3><p>Добавьте первый стол, затем откройте его QR-код для печати.</p>
      </div>}
      {!loading && data && data.tables.length > 0 && <div className="manage-table-list">
        {data.tables.map((table) => <article className={`manage-table-card${table.isActive ? "" : " is-inactive"}`} key={table.id}>
          <div className="manage-table-card-head">
            <div><span className={`manage-status${table.isActive ? " is-active" : ""}`}>{table.isActive ? "Активен" : "Выключен"}</span>
              {editingId === table.id ? <label className="manage-table-edit-label" htmlFor={`table-name-${table.id}`}>Название стола</label>
                : <h3>{table.name}</h3>}
            </div>
            {editingId !== table.id && <div className="manage-table-card-actions">
              <button ref={(element) => { if (element) editButtonRefs.current.set(table.id, element); else editButtonRefs.current.delete(table.id); }}
                type="button" className="manage-secondary-button" onClick={() => beginEdit(table)}>Изменить название</button>
              <button type="button" className="manage-secondary-button" onClick={() => void toggleActive(table)} disabled={savingId === table.id}>
                {savingId === table.id ? "Сохраняем…" : table.isActive ? "Выключить" : "Включить"}
              </button>
              <button type="button" className="manage-primary-button" onClick={() => showQr(table)}>
                {selectedQrId === table.id ? "Скрыть QR" : "QR-код"}
              </button>
            </div>}
          </div>
          {editingId === table.id && <form className="manage-table-edit" onSubmit={(event) => { event.preventDefault(); void saveName(table); }}>
            <input id={`table-name-${table.id}`} value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={60} required autoFocus />
            <button type="submit" className="manage-primary-button" disabled={savingId === table.id || !editName.trim()}>{savingId === table.id ? "Сохраняем…" : "Сохранить"}</button>
            <button type="button" className="manage-secondary-button" onClick={() => { setEditingId(null); requestAnimationFrame(() => editButtonRefs.current.get(table.id)?.focus()); }} disabled={savingId === table.id}>Отмена</button>
          </form>}
          {selectedQrId === table.id && <div className="manage-table-qr" aria-live="polite">
            {qr?.id === table.id ? <>
              <img src={qr.dataUrl} width="320" height="384" alt={`QR-код: ${data.cafe.name}, ${table.name}`} />
              <div className="manage-table-qr-copy"><strong>{data.cafe.name}</strong><span>{table.name}</span>
                <p>Этот QR-код ведёт в меню указанного кафе и стола. Для гостя откроется актуальное меню.</p>
                <div className="manage-table-qr-actions">
                  <a className="manage-primary-button" href={qr.dataUrl} download={`menugo-${safeFileName(table.name)}.svg`}>Скачать для печати</a>
                  <a className="manage-secondary-button" href={qr.url} target="_blank" rel="noreferrer">Проверить меню</a>
                </div>
              </div>
            </> : qrError ? <p className="manage-message is-error" role="alert">{qrError}</p>
              : <p role="status">Создаём QR-код…</p>}
          </div>}
        </article>)}
      </div>}
      <p className="manage-tables-note">Выключенный стол скрыт для гостей. Существующие заказы и сохранённые названия столов не меняются.</p>
    </section>
  );
}
