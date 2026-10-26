import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AuthApiError } from "./api";
import {
  createCategory, createDish, fetchManagedMenu, ManageApiError, removeDishImage, uploadDishImage, type ManagedCategory, type ManagedDish,
  updateCategory, updateDish,
} from "./manageApi";
import { refreshCsrf } from "./state";

const som = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

function sorted(categories: ManagedCategory[]): ManagedCategory[] {
  return categories.map((category) => ({
    ...category,
    dishes: [...category.dishes].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ru")),
  })).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ru"));
}

function manageMessage(error: unknown): string {
  if (error instanceof ManageApiError) return error.message;
  if (error instanceof AuthApiError) {
    if (error.code === "CSRF_INVALID") return "Защитный токен устарел. Обновите защиту и повторите действие.";
    if (error.code === "ORIGIN_FORBIDDEN") return "Источник запроса не разрешён. Обратитесь к администратору.";
    if (error.status === 503) return "Сервис временно недоступен. Попробуйте позже.";
    if (error.status === 0) return "Не удалось связаться с сервером. Проверьте подключение и попробуйте ещё раз.";
    return error.message;
  }
  return "Не удалось связаться с сервером. Проверьте подключение и попробуйте ещё раз.";
}

interface CategoryCardProps {
  category: ManagedCategory;
  busy: string | null;
  onSaveCategory: (id: string, input: { name: string; sortOrder: number }) => Promise<void>;
  onToggleCategory: (category: ManagedCategory) => Promise<void>;
  onCreateDish: (input: Omit<ManagedDish, "id">) => Promise<boolean>;
  onSaveDish: (id: string, input: Omit<ManagedDish, "id">) => Promise<void>;
  onToggleDish: (dish: ManagedDish) => Promise<void>;
  onImageChange: (id: string, file?: File) => Promise<void>;
}

function CategoryCard({ category, busy, onSaveCategory, onToggleCategory, onCreateDish, onSaveDish, onToggleDish, onImageChange }: CategoryCardProps) {
  const [name, setName] = useState(category.name);
  const [sortOrder, setSortOrder] = useState(String(category.sortOrder));
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newSortOrder, setNewSortOrder] = useState("0");

  useEffect(() => { setName(category.name); setSortOrder(String(category.sortOrder)); }, [category.name, category.sortOrder]);

  return (
    <article className={`manage-category${category.isActive ? "" : " is-inactive"}`}>
      <header className="manage-category-header">
        <div className="manage-category-title">
          <span className={`manage-status${category.isActive ? " is-active" : ""}`}>
            {category.isActive ? "Активна" : "Скрыта от гостей"}
          </span>
          <h3>{category.name}</h3>
          <p>Порядок: {category.sortOrder} · Блюд: {category.dishes.length}</p>
        </div>
        <button type="button" className="manage-secondary-button" disabled={busy !== null}
          onClick={() => void onToggleCategory(category)}>
          {category.isActive ? "Скрыть категорию" : "Включить категорию"}
        </button>
      </header>

      <details className="manage-disclosure">
        <summary>Изменить категорию</summary>
        <form className="manage-form manage-category-edit" onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void onSaveCategory(category.id, { name, sortOrder: Number(sortOrder) });
        }}>
          <label>Название категории<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required disabled={busy !== null} /></label>
          <label>Порядок сортировки<input type="number" min="0" step="1" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} required disabled={busy !== null} /></label>
          <button className="manage-primary-button" type="submit" disabled={busy !== null}>{busy === `category:${category.id}` ? "Сохраняем…" : "Сохранить категорию"}</button>
        </form>
      </details>

      <div className="manage-dish-list">
        {category.dishes.length === 0 ? <p className="manage-empty-inline">В этой категории пока нет блюд.</p> : null}
        {category.dishes.map((dish) => (
          <DishRow key={dish.id} dish={dish} busy={busy} onSaveDish={onSaveDish} onToggleDish={onToggleDish} onImageChange={onImageChange} />
        ))}
      </div>

      <details className="manage-disclosure manage-add-dish">
        <summary>Добавить блюдо</summary>
        <form className="manage-form manage-dish-form" onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void onCreateDish({ categoryId: category.id, name: newName, description: newDescription,
            priceSom: Number(newPrice), sortOrder: Number(newSortOrder), isAvailable: true }).then((saved) => {
              if (saved) { setNewName(""); setNewDescription(""); setNewPrice(""); setNewSortOrder("0"); }
            });
        }}>
          <label>Название блюда<input value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={120} required disabled={busy !== null} /></label>
          <label>Цена, сом<input type="number" min="0" max="9007199254740991" step="1" inputMode="numeric" value={newPrice} onChange={(event) => setNewPrice(event.target.value)} required disabled={busy !== null} /></label>
          <label className="manage-span-full">Описание<textarea value={newDescription} onChange={(event) => setNewDescription(event.target.value)} rows={3} maxLength={500} disabled={busy !== null} /></label>
          <label>Порядок сортировки<input type="number" min="0" step="1" value={newSortOrder} onChange={(event) => setNewSortOrder(event.target.value)} required disabled={busy !== null} /></label>
          <button className="manage-primary-button" type="submit" disabled={busy !== null}>{busy === `new-dish:${category.id}` ? "Добавляем…" : "Сохранить блюдо"}</button>
        </form>
      </details>
    </article>
  );
}

function DishRow({ dish, busy, onSaveDish, onToggleDish, onImageChange }: {
  dish: ManagedDish;
  busy: string | null;
  onSaveDish: (id: string, input: Omit<ManagedDish, "id">) => Promise<void>;
  onToggleDish: (dish: ManagedDish) => Promise<void>;
  onImageChange: (id: string, file?: File) => Promise<void>;
}) {
  const [name, setName] = useState(dish.name);
  const [description, setDescription] = useState(dish.description);
  const [priceSom, setPriceSom] = useState(String(dish.priceSom));
  const [sortOrder, setSortOrder] = useState(String(dish.sortOrder));
  const imageInput = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState("");

  useEffect(() => {
    setName(dish.name);
    setDescription(dish.description);
    setPriceSom(String(dish.priceSom));
    setSortOrder(String(dish.sortOrder));
  }, [dish.name, dish.description, dish.priceSom, dish.sortOrder]);

  return (
    <article className={`manage-dish${dish.isAvailable ? "" : " is-inactive"}`}>
      <div className="manage-dish-summary">
        <div className="manage-dish-copy">
          <span className={`manage-status${dish.isAvailable ? " is-active" : ""}`}>
            {dish.isAvailable ? "Доступно гостям" : "Нет в гостевом меню"}
          </span>
          <h4>{dish.name}</h4>
          {dish.description ? <p>{dish.description}</p> : null}
        </div>
        <div className="manage-dish-price">{som.format(dish.priceSom)} <span>сом</span></div>
      </div>
      <div className="manage-image-control">
        {dish.imageUrl && <img className="manage-image-preview" src={dish.imageUrl} alt={`Фото блюда «${dish.name}»`} />}
        <div className="manage-image-actions">
          <input ref={imageInput} className="manage-image-input" type="file" accept="image/jpeg,image/png,image/webp"
            aria-label={`Выбрать фото блюда «${dish.name}»`} disabled={busy !== null}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
                setImageError("Выберите изображение JPEG, PNG или WebP."); event.target.value = ""; return;
              }
              if (file.size > 5 * 1024 * 1024) {
                setImageError("Размер изображения не должен превышать 5 МБ."); event.target.value = ""; return;
              }
              setImageError("");
              void onImageChange(dish.id, file).then(() => { event.target.value = ""; });
            }} />
          <button type="button" className="manage-secondary-button" disabled={busy !== null}
            onClick={() => imageInput.current?.click()}>
            {busy === `image:${dish.id}` ? "Загружаем фото…" : dish.imageUrl ? "Заменить фото" : "Добавить фото"}
          </button>
          {dish.imageUrl && <button type="button" className="manage-secondary-button" disabled={busy !== null}
            onClick={() => { setImageError(""); void onImageChange(dish.id); }}>Убрать фото</button>}
        </div>
        {imageError && <p className="manage-image-error" role="alert">{imageError}</p>}
      </div>
      <div className="manage-dish-actions">
        <button type="button" className="manage-secondary-button" disabled={busy !== null}
          onClick={() => void onToggleDish(dish)}>
          {dish.isAvailable ? "Скрыть из меню" : "Вернуть в меню"}
        </button>
        <details className="manage-disclosure manage-dish-disclosure">
          <summary>Изменить блюдо</summary>
          <form className="manage-form manage-dish-form" onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            void onSaveDish(dish.id, { categoryId: dish.categoryId, name, description,
              priceSom: Number(priceSom), sortOrder: Number(sortOrder), isAvailable: dish.isAvailable });
          }}>
            <label>Название блюда<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required disabled={busy !== null} /></label>
            <label>Цена, сом<input type="number" min="0" max="9007199254740991" step="1" inputMode="numeric" value={priceSom} onChange={(event) => setPriceSom(event.target.value)} required disabled={busy !== null} /></label>
            <label className="manage-span-full">Описание<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={500} disabled={busy !== null} /></label>
            <label>Порядок сортировки<input type="number" min="0" step="1" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} required disabled={busy !== null} /></label>
            <button className="manage-primary-button" type="submit" disabled={busy !== null}>{busy === `dish:${dish.id}` ? "Сохраняем…" : "Сохранить блюдо"}</button>
          </form>
        </details>
      </div>
    </article>
  );
}

export default function MenuManager() {
  const [categories, setCategories] = useState<ManagedCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const lock = useRef(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategorySortOrder, setNewCategorySortOrder] = useState("0");
  const [message, setMessage] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      setCategories(sorted(await fetchManagedMenu()));
      setMessage(null);
    } catch (error) {
      setMessage({ kind: "error", text: manageMessage(error) });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function applyCategory(updated: ManagedCategory) {
    setCategories((current) => sorted(current.some((item) => item.id === updated.id)
      ? current.map((item) => item.id === updated.id ? { ...updated, dishes: item.dishes } : item)
      : [...current, updated]));
  }

  function applyDish(updated: ManagedDish, isNew = false) {
    setCategories((current) => sorted(current.map((category) => {
      const withoutDish = category.dishes.filter((dish) => dish.id !== updated.id);
      if (category.id !== updated.categoryId) return { ...category, dishes: withoutDish };
      return { ...category, dishes: isNew || !category.dishes.some((dish) => dish.id === updated.id)
        ? [...withoutDish, updated] : withoutDish.concat(updated) };
    })));
  }

  async function save<T>(key: string, action: () => Promise<T>, apply: (result: T) => void, successText: string): Promise<boolean> {
    if (lock.current) return false;
    lock.current = true;
    setBusy(key);
    setMessage(null);
    try {
      const result = await action();
      apply(result);
      setMessage({ kind: "success", text: successText });
      try { setCategories(sorted(await fetchManagedMenu())); }
      catch (error) {
        if (error instanceof ManageApiError && error.status === 401) return true;
        setMessage({ kind: "info", text: "Изменение сохранено. Не удалось обновить список; нажмите «Обновить список»." });
      }
      return true;
    } catch (error) {
      setMessage({ kind: "error", text: manageMessage(error) });
      return false;
    } finally {
      setBusy(null);
      lock.current = false;
    }
  }

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await save("new-category", () => createCategory({ name: newCategoryName, sortOrder: Number(newCategorySortOrder) }),
      (category) => { applyCategory(category); setNewCategoryName(""); setNewCategorySortOrder("0"); }, "Категория добавлена.");
  }

  async function editCategory(id: string, input: { name: string; sortOrder: number }) {
    await save(`category:${id}`, () => updateCategory(id, input), applyCategory, "Изменения категории сохранены.");
  }

  async function toggleCategory(category: ManagedCategory) {
    await save(`category:${category.id}`, () => updateCategory(category.id, { isActive: !category.isActive }),
      applyCategory, category.isActive ? "Категория скрыта от гостей." : "Категория снова видна гостям.");
  }

  async function addDish(input: Omit<ManagedDish, "id">): Promise<boolean> {
    return save(`new-dish:${input.categoryId}`, () => createDish(input), (dish) => applyDish(dish, true), "Блюдо добавлено.");
  }

  async function editDish(id: string, input: Omit<ManagedDish, "id">) {
    await save(`dish:${id}`, () => updateDish(id, input), (dish) => applyDish(dish), "Изменения блюда сохранены.");
  }

  async function toggleDish(dish: ManagedDish) {
    await save(`dish:${dish.id}`, () => updateDish(dish.id, { isAvailable: !dish.isAvailable }),
      (updated) => applyDish(updated), dish.isAvailable ? "Блюдо скрыто из гостевого меню." : "Блюдо снова доступно гостям.");
  }

  async function changeImage(id: string, file?: File) {
    if (lock.current) return;
    lock.current = true;
    setBusy(`image:${id}`);
    setMessage(null);
    try {
      const result = file ? await uploadDishImage(id, file) : await removeDishImage(id);
      setCategories((current) => current.map((category) => ({
        ...category,
        dishes: category.dishes.map((dish) => dish.id === id
          ? { ...dish, imageUrl: result.imageUrl ?? undefined }
          : dish),
      })));
      setMessage({ kind: result.cleanupPending ? "info" : "success", text: result.message ?? (file ? "Фото блюда сохранено." : "Фото блюда удалено.") });
    } catch (error) {
      setMessage({ kind: "error", text: manageMessage(error) });
    } finally {
      setBusy(null);
      lock.current = false;
    }
  }

  return (
    <section className="manage-menu" aria-labelledby="manage-menu-title">
      <div className="manage-heading-row">
        <div>
          <p className="auth-eyebrow">УПРАВЛЕНИЕ КАФЕ</p>
          <h2 id="manage-menu-title">Меню и блюда</h2>
          <p className="manage-lead">Изменения сохраняются в меню вашего кафе.</p>
        </div>
        <button type="button" className="manage-secondary-button" onClick={() => void load(true)} disabled={refreshing || loading || busy !== null}>
          {refreshing ? "Обновляем…" : "Обновить список"}
        </button>
      </div>

      {message && <div className={`manage-message is-${message.kind}`} role={message.kind === "error" ? "alert" : "status"} aria-live="polite">
        <p>{message.text}</p>
        {message.kind === "error" && (message.text.toLocaleLowerCase("ru-RU").includes("csrf") ||
          message.text.toLocaleLowerCase("ru-RU").includes("защитный токен")) && (
          <button type="button" className="manage-link-button" onClick={() => void refreshCsrf().then(
            () => setMessage({ kind: "success", text: "Защитная сессия обновлена. Повторите действие." }),
            () => setMessage({ kind: "error", text: "Не удалось обновить защиту. Проверьте соединение и попробуйте снова." }),
          )}>Обновить защиту</button>
        )}
      </div>}

      <form className="manage-create-category" onSubmit={(event) => void addCategory(event)}>
        <div>
          <h3>Новая категория</h3>
          <p>Например, «Завтраки» или «Напитки».</p>
        </div>
        <label>Название<input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} maxLength={80} required disabled={busy !== null} /></label>
        <label>Порядок<input type="number" min="0" step="1" value={newCategorySortOrder} onChange={(event) => setNewCategorySortOrder(event.target.value)} required disabled={busy !== null} /></label>
        <button className="manage-primary-button" type="submit" disabled={busy !== null}>{busy === "new-category" ? "Добавляем…" : "Добавить категорию"}</button>
      </form>

      {loading ? <div className="manage-loading" role="status">Загружаем меню кафе…</div> : categories.length === 0 ? (
        <div className="manage-empty" role="status"><h3>Категорий пока нет</h3><p>Создайте первую категорию, чтобы добавить блюда.</p></div>
      ) : (
        <div className="manage-category-list">
          {categories.map((category) => <CategoryCard key={category.id} category={category} busy={busy}
            onSaveCategory={editCategory} onToggleCategory={toggleCategory} onCreateDish={addDish}
            onSaveDish={editDish} onToggleDish={toggleDish} onImageChange={changeImage} />)}
        </div>
      )}
    </section>
  );
}
