import { useEffect, useRef } from "react";

const dishes = [
  {
    name: "Плов",
    description: "Рис, говядина, морковь и специи",
    weight: "350 г",
    price: "280 сом",
  },
  {
    name: "Свежий салат",
    description: "Томаты, огурцы, зелень и масло",
    weight: "200 г",
    price: "190 сом",
  },
  {
    name: "Чай с чабрецом",
    description: "Чёрный чай и ароматные травы",
    weight: "400 мл",
    price: "80 сом",
  },
];

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <span aria-hidden="true">{diagonal ? "↗" : "→"}</span>;
}

function PhonePreview() {
  return (
    <figure className="phone-figure">
      <div className="phone" aria-label="Демонстрационный макет меню MenuGo">
        <div className="phone-top" aria-hidden="true">
          <span>9:41</span>
          <span className="phone-speaker" />
          <span>•••</span>
        </div>
        <div className="phone-content">
          <div className="phone-brand">
            <strong>MenuGo</strong>
            <span>Стол № 4</span>
          </div>
          <div className="phone-heading">
            <span className="eyebrow">ДЕМО-КАФЕ</span>
            <h2>
              Что вам
              <br />
              приготовить?
            </h2>
            <p>Выбирайте по настроению.</p>
          </div>
          <ul className="categories" aria-label="Примеры категорий меню">
            <li className="selected">Всё меню</li>
            <li>Горячее</li>
            <li>Напитки</li>
          </ul>
          <div className="dish-list">
            {dishes.map((dish, index) => (
              <article className="dish" key={dish.name}>
                <div className="dish-index" aria-hidden="true">
                  0{index + 1}
                </div>
                <div>
                  <div className="dish-title">
                    <h3>{dish.name}</h3>
                    <span>{dish.weight}</span>
                  </div>
                  <p>{dish.description}</p>
                  <strong>{dish.price}</strong>
                </div>
              </article>
            ))}
          </div>
          <p className="phone-note">
            Пример меню · Цены условные
            <br />
            Заказ пока недоступен
          </p>
        </div>
        <div className="home-indicator" aria-hidden="true" />
      </div>
      <figcaption>
        Меню глазами гостя <span>Демонстрационный макет</span>
      </figcaption>
    </figure>
  );
}

function DashboardPreview() {
  return (
    <div className="dashboard" aria-label="Пример будущей панели кафе">
      <div className="dashboard-top">
        <strong>
          MenuGo <span>/ Кафе</span>
        </strong>
        <span className="demo-label">Пример интерфейса</span>
      </div>
      <div className="dashboard-body">
        <div className="dashboard-heading">
          <div>
            <span className="eyebrow">ОБЗОР ЗАЛА</span>
            <h3>Заказы по столам</h3>
          </div>
          <span className="sample">Пример данных</span>
        </div>
        <div className="orders">
          {[
            {
              table: "04",
              status: "Новый заказ",
              className: "new",
              items: "Плов · Салат · Чай",
              amount: "550 сом",
            },
            {
              table: "07",
              status: "Принят",
              className: "accepted",
              items: "Плов · Чай",
              amount: "360 сом",
            },
            {
              table: "02",
              status: "Подан",
              className: "served",
              items: "Салат · Чай",
              amount: "270 сом",
            },
          ].map((order) => (
            <article className="order" key={order.table}>
              <span className={`order-status ${order.className}`}>
                {order.status}
              </span>
              <h4>Стол {order.table}</h4>
              <p>{order.items}</p>
              <strong>{order.amount}</strong>
            </article>
          ))}
        </div>
        <div className="menu-sample">
          <div>
            <span className="eyebrow">МЕНЮ КАФЕ</span>
            <h4>Блюда и цены — в одном месте</h4>
          </div>
          <div className="menu-sample-row">
            <span>
              Плов <small>Горячее</small>
            </span>
            <strong>280 сом</strong>
            <span className="availability">В меню</span>
          </div>
        </div>
      </div>
      <p className="dashboard-note">
        Макет будущей панели. Управление меню и приём заказов ещё в разработке.
      </p>
    </div>
  );
}

export default function App() {
  const stepsRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const steps = stepsRef.current;
    if (!steps || !("IntersectionObserver" in window)) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let observer: IntersectionObserver | undefined;

    function updateMotion() {
      if (!steps) return;
      observer?.disconnect();
      delete steps.dataset.animate;
      if (motion.matches) return;

      const cards = Array.from(steps.children) as HTMLElement[];
      cards.forEach((card) => delete card.dataset.visible);
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            (entry.target as HTMLElement).dataset.visible = "true";
            observer?.unobserve(entry.target);
          });
        },
        { threshold: 0.15 },
      );
      steps.dataset.animate = "true";
      cards.forEach((card) => observer?.observe(card));
    }

    updateMotion();
    motion.addEventListener("change", updateMotion);
    return () => {
      observer?.disconnect();
      motion.removeEventListener("change", updateMotion);
      delete steps.dataset.animate;
    };
  }, []);

  return (
    <>
      <a className="skip-link" href="#main">
        Перейти к содержимому
      </a>
      <header className="header-shell">
        <div className="header wrap">
          <a className="wordmark header-brand" href="#" aria-label="MenuGo — на главную">
            <img
              className="brand-symbol"
              src="/brand/menugo-symbol.svg"
              alt=""
              aria-hidden="true"
              width="717"
              height="489"
            />
            MenuGo
          </a>
          <nav aria-label="Основная навигация">
            <a href="#how-it-works">Как это работает</a>
            <a href="#for-cafe">Для кафе</a>
            <a href="/login">Кабинет</a>
          </nav>
          <a className="header-status" href="#launch">
            <span aria-hidden="true" />
            Готовимся к запуску
          </a>
        </div>
      </header>
      <main id="main">
        <section className="hero wrap" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow hero-eyebrow">
              <span /> МЕНЬШЕ СЛОЖНОСТЕЙ. БОЛЬШЕ ГОСТЕПРИИМСТВА.
            </p>
            <h1 id="hero-title">
              Ваше меню.
              <br />В телефоне
              <br />
              <span>гостя.</span>
            </h1>
            <p className="hero-description">
              От первого взгляда на меню до заказа —
              <br className="desktop-break" /> понятный путь для гостя и команды
              кафе.
            </p>
            <a className="button" href="#how-it-works">
              Как это работает <Arrow />
            </a>
            <p className="hero-disclaimer">
              Знакомство с идеей. Сервис в разработке.
            </p>
          </div>
          <div className="hero-stage">
            <div className="stage-caption">
              <span>ОТКРЫТЬ. ВЫБРАТЬ. ЗАКАЗАТЬ.</span>
              <span>01 / МЕНЮ</span>
            </div>
            <PhonePreview />
            <span className="stage-bottom">Больше внимания вкусу.</span>
          </div>
        </section>
        <div className="intro-strip wrap">
          <span>
            Создаём для кафе.
            <br />
            <strong>Продумываем для людей.</strong>
          </span>
          <p>
            Меню, которое удобно листать.
            <br />
            Заказ, который понятно передать.
          </p>
          <a href="#for-cafe">
            Познакомиться с идеей <Arrow diagonal />
          </a>
        </div>
        <section
          className="process section wrap"
          id="how-it-works"
          aria-labelledby="process-title"
        >
          <div className="section-heading">
            <p className="eyebrow">01 / ПУТЬ ГОСТЯ</p>
            <h2 id="process-title">
              От меню — к заказу.
              <br />
              <span>В три простых шага.</span>
            </h2>
            <p>Так будет устроен MenuGo: всё начинается с QR-кода на столе.</p>
          </div>
          <ol className="steps" ref={stepsRef}>
            {[
              {
                title: "Гость сканирует QR",
                text: "Открывает меню своего стола в браузере телефона.",
                detail: "СВОЙ СТОЛ. СВОЁ МЕНЮ.",
              },
              {
                title: "Выбирает блюда",
                text: "Смотрит состав и цены, выбирает то, что хочется попробовать.",
                detail: "В СВОЁМ ТЕМПЕ.",
              },
              {
                title: "Отправляет заказ",
                text: "Передаёт выбранные блюда команде кафе. Номер стола уже известен.",
                detail: "ПОНЯТНО ГОСТЮ И КОМАНДЕ.",
              },
            ].map((step, index) => (
              <li key={step.title}>
                <div className="step-top">
                  <span>0{index + 1}</span>
                  {index < 2 ? <Arrow /> : <span aria-hidden="true">✓</span>}
                </div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
                <small>{step.detail}</small>
              </li>
            ))}
          </ol>
          <p className="section-note">
            На главной показан макет. Отправка заказа работает только в отдельном гостевом меню.
          </p>
        </section>
        <section
          className="benefits"
          id="for-cafe"
          aria-labelledby="benefits-title"
        >
          <div className="wrap section">
            <div className="benefit-heading">
              <p className="eyebrow">02 / ПО ОБЕ СТОРОНЫ СТОЛА</p>
              <h2 id="benefits-title">
                Гостю — удобный выбор.
                <br />
                <span>Кафе — ясный процесс.</span>
              </h2>
            </div>
            <div className="benefit-grid">
              <article>
                <span className="benefit-tag">ДЛЯ ГОСТЯ</span>
                <h3>
                  Всё меню.
                  <br />В своём ритме.
                </h3>
                <p>
                  Узнать состав, сравнить блюда и спокойно выбрать — прямо за
                  своим столом.
                </p>
                <ul>
                  <li>Категории и цены перед глазами</li>
                  <li>Понятный путь от выбора до заказа</li>
                  <li>Меню открывается в браузере</li>
                </ul>
              </article>
              <article>
                <span className="benefit-tag">ДЛЯ КАФЕ</span>
                <h3>
                  Меньше рутины.
                  <br />
                  Больше внимания гостям.
                </h3>
                <p>
                  Планируем собрать меню и работу с заказами в одном понятном
                  пространстве.
                </p>
                <ul>
                  <li>Управление блюдами и ценами</li>
                  <li>Заказы с привязкой к столу</li>
                  <li>Понятные статусы для команды</li>
                </ul>
              </article>
            </div>
          </div>
        </section>
        <section
          className="panel-section section wrap"
          aria-labelledby="panel-title"
        >
          <div className="panel-copy">
            <p className="eyebrow">03 / НА СТОРОНЕ КАФЕ</p>
            <h2 id="panel-title">
              Весь зал.
              <br />
              <span>Один взгляд.</span>
            </h2>
            <p>
              Идея панели — помочь команде видеть, от какого стола пришёл заказ
              и что происходит дальше.
            </p>
            <p>
              Владелец сможет управлять блюдами и ценами, а сотрудники — следить
              за заказами.
            </p>
            <span className="outline-label">Концепция будущего интерфейса</span>
          </div>
          <DashboardPreview />
        </section>
        <section
          className="launch wrap"
          id="launch"
          aria-labelledby="launch-title"
        >
          <div className="launch-logo">
            <img
              src="/brand/menugo.jpg"
              alt="Утверждённый логотип MenuGo"
              width="1254"
              height="1254"
              loading="lazy"
            />
          </div>
          <div className="launch-copy">
            <p className="eyebrow">НАЧИНАЕМ С ОДНОГО КАФЕ</p>
            <h2 id="launch-title">
              Хороший сервис
              <br />
              начинается с деталей.
            </h2>
            <p>
              Сейчас мы разрабатываем MenuGo и готовимся к первому тестированию
              в кафе. После проверки идеи планируем предложить сервис другим
              заведениям по подписке.
            </p>
            <div className="launch-status">
              <span aria-hidden="true" />
              Сервис в разработке
            </div>
            <small>Панель сотрудников и подключение кафе пока недоступны.</small>
          </div>
        </section>
      </main>
      <footer className="footer wrap">
        <a className="wordmark" href="#" aria-label="MenuGo — наверх">
          MenuGo<span aria-hidden="true">.</span>
        </a>
        <p>Цифровое меню. Живое гостеприимство.</p>
        <a href="#main">
          Наверх <span aria-hidden="true">↑</span>
        </a>
      </footer>
    </>
  );
}
