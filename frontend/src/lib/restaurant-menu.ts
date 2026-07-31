export interface MenuSizeOption {
  size: string;
  price: number;
}

export interface MenuItem {
  name: string;
  price?: number;
  description?: string;
  sizes?: MenuSizeOption[];
}

export interface MenuSection {
  title: string | null;
  items: MenuItem[];
}

export interface MenuSubcategory {
  id: string;
  title: string;
  sections: MenuSection[];
}

export interface MenuTab {
  id: string;
  title: string;
  subcategories: MenuSubcategory[];
}

/** Flattened selectable row (one price variant). */
export interface MenuCatalogItem {
  key: string;
  name: string;
  displayName: string;
  price: number;
  description?: string;
  size?: string;
  tabId: string;
  tabTitle: string;
  subcategoryId: string;
  subcategoryTitle: string;
  sectionTitle: string | null;
}

const coldAppetizersRegular: MenuItem[] = [
  {
    name: "Закуска под водочку",
    price: 2200,
    description: "квашен. капуста, огурцы марин., грибы марин., лук репчат. м/с раст.",
  },
  {
    name: "Русская закуска",
    price: 2800,
    description: "сельдь, огурцы марин., карт. отварн., лук, м/с раст, оливки, лимон",
  },
  {
    name: "Закуска «Кавказ»",
    price: 3500,
    description: "огурцы, помидоры, брынза, перец болгарск., оливки, зелень",
  },
];

const saladsRegular: MenuItem[] = [
  {
    name: "Оливье с колбасой",
    price: 2000,
    description:
      "колбаса варен., картофель, морковь, лук репчат., огурцы марин., зелен. горошек, яйцо, майонез",
  },
  {
    name: "Греческий",
    price: 2100,
    description: "огурцы, помидоры, брынза, листья салата, м/с растит.",
  },
  {
    name: "«Актау»",
    price: 2100,
    description: "огурцы, помидоры, яйцо, чипсы, икра закусочная: красная, черная, майонез",
  },
  {
    name: "Французский",
    price: 2200,
    description: "говядина марин., свеж. овощи, орехи грец., картофель пай, майонез",
  },
  {
    name: "Сельдь под шубой",
    price: 2200,
    description: "сельдь, картофель, морковь, свекла, яйцо, лук репчат., майонез",
  },
  {
    name: "Весна",
    price: 2200,
    description:
      "огурцы свеж., черри, редиска, цвет. капуста, оливки, сыр фетакса, зелень, м/с подсолн.",
  },
  {
    name: "По пекински",
    price: 2300,
    description: "говядина марин., огурцы свеж., перец болгар., зелень, м/с растит.",
  },
  {
    name: "Цезарь с курицей",
    price: 2300,
    description: "филе курин., черри, яйцо, кириешки, сыр пармезан, листья салата, соус",
  },
  {
    name: "Светофор",
    price: 2300,
    description: "брокколи, цветная капуста, перец болг., лук зеленый, маслины, черри",
  },
  {
    name: "На здоровье",
    price: 2300,
    description: "свекла отварн., сыр фетакса, кедровые орешки, руккола, чеснок, м/с растит.",
  },
  {
    name: "Оливье с мясом",
    price: 2300,
    description:
      "говядина отварн., картофель, морковь, лук репчат., огурцы марин., зелен. горошек, яйцо, майонез",
  },
  {
    name: "Португальский",
    price: 2400,
    description:
      "сыр твердый, говядина отварн., грибы солен., огурцы свеж., помидоры, картофель пай, листья салата, м/с растит.",
  },
  {
    name: "Азия",
    price: 2400,
    description:
      "говядина отварн., лук красн., перец болгар., огурцы марин., помидоры, фасоль, листья салата, м/с растит.",
  },
  {
    name: "Пикантный",
    price: 2500,
    description: "филе говядины, перец болг., огурцы, помидоры, морковь, руккола",
  },
  {
    name: "«Тбилиси»",
    price: 2500,
    description:
      "говядина отварн., помидоры, перец болгар., фасоль, грец. орехи, кинза, чеснок, м/с растит.",
  },
  {
    name: "Хрустящие баклажаны",
    price: 2600,
    description: "баклажаны, черри, кинза зелен., чеснок, кисло-сладкий соус",
  },
  {
    name: "От Шефа",
    price: 3000,
    description: "язык гов., кур. филе, огурцы, яич. блин, кукуруза десерт., картофель пай",
  },
];

export const restaurantMenu: MenuTab[] = [
  {
    id: "new",
    title: "Новинки",
    subcategories: [
      {
        id: "new-items",
        title: "Новинки",
        sections: [
          {
            title: null,
            items: [
              { name: "Бургер", price: 1400 },
              { name: "Донер", price: 1400 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "main",
    title: "Основное меню",
    subcategories: [
      {
        id: "salads",
        title: "Салаты",
        sections: [{ title: null, items: saladsRegular }],
      },
      {
        id: "soups",
        title: "Первые блюда",
        sections: [
          {
            title: null,
            items: [
              { name: "Суп - пюре чечевичный", price: 1000 },
              { name: "Суп с фрикадельками", price: 1200 },
              { name: "Лапша п. дом. с курицей", price: 1200 },
              { name: "Окрошка", price: 1200 },
              { name: "Пельмени с бульоном", price: 1300 },
              { name: "Мясо по казахски", price: 1500 },
              { name: "Шорпа по узбекски", price: 1500 },
              { name: "Мампар", price: 1500 },
              { name: "Пельмени б/бульона", price: 1600 },
              { name: "Солянка сборная", price: 1700 },
              { name: "Суп по Французски", price: 1800 },
              { name: "Уха по царски", price: 2300 },
            ],
          },
        ],
      },
      {
        id: "hot-poultry",
        title: "Блюда из птицы",
        sections: [
          {
            title: null,
            items: [
              {
                name: "Курица с овощами",
                price: 2200,
                description: "филе курин., лук репчат., перец болгар., фасоль, помидоры, цвет. капуста",
              },
              {
                name: "Утиная грудка с овощами",
                price: 2200,
                description: "утин. грудка, перец болгар., лук репчат., цвет. капуста, зелен. горошек",
              },
              {
                name: "Стейк из курицы с грибами",
                price: 2500,
                description: "филе курин., помидоры, грибы марин., сыр, майонез",
              },
            ],
          },
        ],
      },
      {
        id: "hot-beef",
        title: "Говядина и телятина",
        sections: [
          {
            title: null,
            items: [
              { name: "Бифштекс", price: 1300 },
              { name: "Бризоль", price: 1700, description: "фарш говяж., яйцо" },
              {
                name: "Мясо по тайски",
                price: 2200,
                description: "филе говяд., перец болгар., огурцы свеж., лук репчат., приправы",
              },
              {
                name: "Язык под сырной корочкой",
                price: 2200,
                description: "язык говяж., лук репчат., сыр",
              },
              {
                name: "Гуйру лагман",
                price: 2300,
                description: "филе говяд., перец болгар., перец полугор., бассай, джандо, тесто",
              },
              {
                name: "Лагман по домашнему",
                price: 2100,
                description: "филе говяд., перец болгар., картофель, лук репчат., бассай, тесто",
              },
              { name: "Фри с мясом", price: 2300, description: "язык говяж., лук репчат., сор" },
              {
                name: "Мясо по французски",
                price: 2400,
                description: "филе говяд., лук репчат., фри, сыр",
              },
              {
                name: "Телятина в восточном стиле",
                price: 2500,
                description: "телятина, перец болгар., черри, джандо",
              },
              {
                name: "Телятина в сливочном соусе",
                price: 2500,
                description: "телятина, перец болгар., лук зелен., сливочный соус",
              },
              {
                name: "Медальоны",
                price: 3000,
                description: "филе говяд., черри, зелень, соусы",
              },
              {
                name: "Мясо по королевски",
                price: 3200,
                description:
                  "филе говяд., филе курин., язык говяж., перец болгар., шампиньоны, сливочный соус",
              },
              {
                name: "Стейк «Стриплоин»",
                price: 3500,
                description: "филе говяд., черри, соус терияки, соус слив., зелень",
              },
            ],
          },
        ],
      },
      {
        id: "hot-lamb",
        title: "Баранина",
        sections: [
          {
            title: null,
            items: [
              { name: "Казан шашлык", price: 2200 },
              { name: "Баранина с овощами", price: 2600 },
              {
                name: "Баранина на сковороде с жареной картошкой и грибами",
                price: 2900,
              },
            ],
          },
        ],
      },
      {
        id: "hot-fish",
        title: "Рыба",
        sections: [
          {
            title: null,
            items: [
              { name: "Сазан жаренный по домашнему", price: 1800 },
              { name: "Судак запеченный под сырной корочкой", price: 2600 },
              { name: "Стейк семги", price: 5500 },
            ],
          },
        ],
      },
      {
        id: "shashlik",
        title: "Шашлыки",
        sections: [
          {
            title: null,
            items: [
              { name: "Крылышки", price: 1700 },
              { name: "Шашлык из утин. грудки", price: 1800 },
              { name: "Шашлык с баранины", price: 2000 },
            ],
          },
        ],
      },
      {
        id: "pizza",
        title: "Пицца и чебуреки",
        sections: [
          {
            title: null,
            items: [
              { name: "Чебуреки маленькие (1 шт)", price: 300 },
              { name: "Чебуреки большие (1 шт)", price: 400 },
              { name: "Чебуреки 1 порц (6 шт) с соусом", price: 2500 },
              {
                name: "Пицца «Маргарита»",
                price: 2600,
                description: "сыр моцарелла, помидоры",
              },
              { name: "Пицца «Маргарита» с двойн. сыром", price: 3200 },
              {
                name: "Пицца «Пепперони»",
                price: 2600,
                description: "колбаса, помидоры, сыр моцарелла",
              },
              { name: "Пицца «Пепперони» с двойн. сыром", price: 3200 },
              {
                name: "Пицца «Поло»",
                price: 2600,
                description: "курица, грибы, сыр моц., помидоры",
              },
              { name: "Пицца «Поло» двойн. сыром", price: 3200 },
              {
                name: "Пицца «Болоньеза»",
                price: 3000,
                description: "фарш говядина, помидоры, сыр моц.",
              },
              { name: "Пицца «Болоньеза» с двойн. сыром", price: 3650 },
              { name: "Хачапури по Мегрельски", price: 3500 },
              { name: "Хачапури по Аджарский", price: 3500 },
            ],
          },
        ],
      },
      {
        id: "sides",
        title: "Гарниры и хлеб",
        sections: [
          {
            title: "Гарниры",
            items: [
              { name: "Картофель - фри", price: 700 },
              { name: "Сложный гарнир", price: 600 },
              {
                name: "Риззота",
                price: 650,
                description: "рис, кукуруза, десертная, зелен. горошек",
              },
              { name: "Рис припущенный", price: 800 },
            ],
          },
          {
            title: "Хлеб",
            items: [
              { name: "Лепёшка с кунжутом маленькая", price: 80 },
              { name: "Лепёшка", price: 150 },
              { name: "Баурсаки", price: 1500 },
            ],
          },
          {
            title: "Выпечка",
            items: [
              { name: "Пирожки печеные / жареные с капустой", price: 200 },
              { name: "Пирожки печеные / жареные с картошкой", price: 200 },
              { name: "Беляши", price: 200 },
              { name: "Булочки с изюмом и курагой", price: 250 },
              { name: "Булочки с сухофруктами", price: 170 },
              { name: "Сосиска в тесте", price: 250 },
              { name: "Самса слоенная", price: 300 },
              { name: "Самса «Уйгурская» (песочная)", price: 300 },
            ],
          },
        ],
      },
      {
        id: "cold-snacks",
        title: "Холодные закуски",
        sections: [{ title: null, items: coldAppetizersRegular }],
      },
    ],
  },
  {
    id: "drinks",
    title: "Горячие напитки",
    subcategories: [
      {
        id: "hot-drinks",
        title: "Горячие напитки",
        sections: [
          {
            title: null,
            items: [
              { name: "Чай чёрный", price: 150 },
              { name: "Чай зелёный", price: 150 },
              { name: "Чай с молоком", price: 250 },
              { name: "Чай с лимоном", price: 350 },
              { name: "Кофе черное", price: 400 },
              { name: "Кофе «Эспрессо»", price: 400 },
              { name: "Кофе с молоком", price: 780 },
              { name: "Кофе «Латте»", price: 500 },
              { name: "Кофе «Капучино»", price: 400 },
            ],
          },
        ],
      },
      {
        id: "tea-pots",
        title: "Чай в чайниках",
        sections: [
          {
            title: null,
            items: [
              { name: "Чайник чая без молока", price: 500 },
              { name: "Чайник чая зеленого", price: 500 },
              { name: "Чайник чая с молоком", price: 600 },
              { name: "Компот с каркадэ и сухофрукт", price: 900 },
              { name: "Чайник чая Облепихового", price: 1200 },
              { name: "Чайник чая «Ташкентский»", price: 1400 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "bar",
    title: "Барное меню",
    subcategories: [
      {
        id: "bar-non-alcoholic",
        title: "Безалкогольные",
        sections: [
          {
            title: null,
            items: [
              { name: "Молочный Коктейль Швейцария", price: 700 },
              {
                name: "Кока-кола",
                sizes: [
                  { size: "0.5L", price: 650 },
                  { size: "1L", price: 900 },
                  { size: "1.5L", price: 1100 },
                  { size: "2L", price: 1300 },
                ],
              },
              {
                name: "Фанта",
                sizes: [
                  { size: "0.5L", price: 650 },
                  { size: "1L", price: 900 },
                  { size: "1.5L", price: 1100 },
                  { size: "2L", price: 1300 },
                ],
              },
              {
                name: "Фьюс ти",
                sizes: [
                  { size: "0.5L", price: 600 },
                  { size: "1L", price: 900 },
                ],
              },
              { name: "Флэш ж/б", price: 700 },
              {
                name: "Пепси",
                sizes: [
                  { size: "0.5L", price: 600 },
                  { size: "1L", price: 850 },
                  { size: "1.5L", price: 1100 },
                  { size: "2L", price: 1200 },
                ],
              },
              {
                name: "Спрайт",
                sizes: [
                  { size: "0.5L", price: 650 },
                  { size: "1L", price: 900 },
                  { size: "1.5L", price: 1100 },
                  { size: "2L", price: 1300 },
                ],
              },
              { name: "Диззи в стекле", price: 800 },
              {
                name: "Боржоми в стекле",
                sizes: [{ size: "0.5L", price: 1000 }],
              },
              {
                name: "Асу с газом и без газа",
                sizes: [
                  { size: "0.5L", price: 400 },
                  { size: "1L", price: 550 },
                  { size: "1.5L", price: 650 },
                ],
              },
              {
                name: "Асу с лимоном",
                sizes: [{ size: "0.5L", price: 500 }],
              },
              {
                name: "Пико палпи",
                sizes: [{ size: "1L", price: 1100 }],
              },
              {
                name: "Сок Грация",
                sizes: [
                  { size: "1L", price: 1250 },
                  { size: "Апельсин 1L", price: 1550 },
                ],
              },
              {
                name: "Сок Дада",
                sizes: [{ size: "1L", price: 1000 }],
              },
              {
                name: "Трубочный сок Пико",
                sizes: [{ size: "0.2L", price: 350 }],
              },
              {
                name: "Сок Пико в тетрапакете",
                sizes: [{ size: "1L", price: 1000 }],
              },
            ],
          },
        ],
      },
      {
        id: "bar-alcoholic",
        title: "Алкогольные",
        sections: [
          {
            title: "Пиво",
            items: [
              { name: "Прага разлив", sizes: [{ size: "0.5L", price: 800 }] },
              { name: "Бланж", sizes: [{ size: "0.5L ж/б", price: 1100 }] },
              { name: "Миллер ж/б", sizes: [{ size: "0.5L", price: 1200 }] },
              { name: "Миллер в стекле", sizes: [{ size: "0.5L", price: 1300 }] },
              { name: "Миллер", sizes: [{ size: "0.33L", price: 950 }] },
              { name: "Балтика нулевка", sizes: [{ size: "0.45L ж/б", price: 700 }] },
              { name: "Житнейский гусь", sizes: [{ size: "0.5L", price: 750 }] },
              { name: "Козел", sizes: [{ size: "0.5L", price: 900 }] },
              { name: "Кружка свежего", sizes: [{ size: "0.5L ж/б", price: 750 }] },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "desserts",
    title: "Десерты",
    subcategories: [
      {
        id: "desserts-all",
        title: "Десерты",
        sections: [
          {
            title: null,
            items: [
              { name: "Оладьи (3 шт)", price: 300 },
              { name: "Сырники (2 шт)", price: 450 },
              { name: "Блины", price: 150 },
              { name: "Блины фаршированные", price: 300 },
              { name: "Морожное", price: 700 },
              { name: "Коктейль", price: 800 },
            ],
          },
        ],
      },
      {
        id: "pastry",
        title: "Пироги",
        sections: [
          {
            title: null,
            items: [
              { name: "Печенье «Вареники»", price: 2000 },
              { name: "Пирог «Шарлотка»", price: 3500 },
              { name: "Пирог «Бисквитный»", price: 3500 },
              { name: "Пирог «Шоколадный»", price: 3500 },
              { name: "Пирог «Творожный»", price: 4000 },
              { name: "Пирог «Мясной»", price: 4500 },
              { name: "Пирог с ягодами и сметаной заливкой", price: 4500 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "custom",
    title: "Заказные блюда",
    subcategories: [
      {
        id: "custom-cold",
        title: "Холодные закуски",
        sections: [
          {
            title: null,
            items: [
              {
                name: "Закуска с фрикадельками (порц.)",
                price: 2500,
                description:
                  "фрикадельки, черри, перец болгар., грибы древесн., зелень, м/с растит.",
              },
              {
                name: "Ассорти рыбное 300",
                price: 5000,
                description: "семга копчен., эскалар, лимон, оливки",
              },
              {
                name: "Ассорти «Казахстан» 300",
                price: 6500,
                description: "казы, жая, язык говяж., помидоры, зелень",
              },
              {
                name: "Мясо - микс (порц.)",
                price: 7000,
                description: "крылышки в панировке, рыба в кляре, голень запечен., зелень",
              },
              { name: "Судак под сыром (1 шт)", price: 12500 },
            ],
          },
        ],
      },
      {
        id: "custom-salads",
        title: "Салаты",
        sections: [
          {
            title: null,
            items: [
              {
                name: "Каприз",
                price: 2500,
                description: "филе курин., брокколи, цвет. капуста, черри, шпинат, редиска",
              },
              {
                name: "Чародейка",
                price: 3300,
                description:
                  "филе курин., черри, руккола, тыква, творожный сыр, перепелин. яйца",
              },
            ],
          },
        ],
      },
      {
        id: "custom-hot",
        title: "На компанию",
        sections: [
          {
            title: null,
            items: [
              { name: "Голубцы (1 шт)", price: 380 },
              { name: "Перец фаршированный (1 шт)", price: 380 },
              { name: "Манты (1 шт)", price: 350 },
              {
                name: "Дапанджи (1 блюдо)",
                price: 12000,
                description: "курин. мясо, картофель, перец болгар., морковь, зелень, рулет из теста",
              },
              {
                name: "Плов (1 блюдо)",
                price: 14000,
                description: "говядина или баранина, рис, морковь, приправы",
              },
              {
                name: "Бешбармак б/казы (1 блюдо)",
                price: 17000,
                description: "конина или говядина",
              },
              {
                name: "Сырне (1 блюдо)",
                price: 19500,
                description: "баранина, перец болгар., морковь, картофель, зелень",
              },
              {
                name: "Бешбармак с казы (1 блюдо)",
                price: 20000,
                description: "конина, казы, жайма, лук репчат.",
              },
              {
                name: "Мясо по армянски (1 блюдо)",
                price: 20500,
                description:
                  "ребра говяд., перец болгар., картофель, морковь, лук репчат., зелень, розочки из теста",
              },
            ],
          },
        ],
      },
    ],
  },
];

function catalogKey(name: string, size?: string): string {
  return size ? `${name}::${size}` : name;
}

export function flattenMenu(menu: MenuTab[] = restaurantMenu): MenuCatalogItem[] {
  const items: MenuCatalogItem[] = [];
  for (const tab of menu) {
    for (const sub of tab.subcategories) {
      for (const section of sub.sections) {
        for (const item of section.items) {
          if (item.sizes?.length) {
            for (const sizeOpt of item.sizes) {
              items.push({
                key: catalogKey(item.name, sizeOpt.size),
                name: item.name,
                displayName: `${item.name} (${sizeOpt.size})`,
                price: sizeOpt.price,
                description: item.description,
                size: sizeOpt.size,
                tabId: tab.id,
                tabTitle: tab.title,
                subcategoryId: sub.id,
                subcategoryTitle: sub.title,
                sectionTitle: section.title,
              });
            }
          } else if (typeof item.price === "number") {
            items.push({
              key: catalogKey(item.name),
              name: item.name,
              displayName: item.name,
              price: item.price,
              description: item.description,
              tabId: tab.id,
              tabTitle: tab.title,
              subcategoryId: sub.id,
              subcategoryTitle: sub.title,
              sectionTitle: section.title,
            });
          }
        }
      }
    }
  }
  return items;
}

export function searchCatalogItems(
  query: string,
  items: MenuCatalogItem[],
): MenuCatalogItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const haystack = [
      item.displayName,
      item.name,
      item.description,
      item.tabTitle,
      item.subcategoryTitle,
      item.sectionTitle,
      item.size,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}
