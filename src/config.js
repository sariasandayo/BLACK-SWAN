// バランス調整用の数値と、画面に出す名前・説明は、すべてこのファイルにまとめる。
// 通貨や都市を増やすときも、ここに1行足すだけでよい
// （新しい通貨は、追加後に tools/fetch-rates.js を実行し直してデータを取り直す）。

export const CONFIG = {
  // ── 1周の設定 ──
  run: {
    lengthDays: 120, // 1周の期間（開始日から期日までの日数）
    initialFunds: 1_000_000, // 初期資金（円）
  },

  // ── 通貨 ──
  // name: 画面に出す名前（噂・記憶の断片の文にも使う）
  // interestRate: 年利（スワップ計算用の簡略化した固定値）
  // spread: 売値と買値の差（円）。0.005 = 0.5銭
  // priceFactor: 弾の値段・報酬を、基準の値段（米ドル相当）から現地通貨に直す倍率
  currencies: {
    JPY: { name: "日本円", interestRate: 0.001, priceFactor: 110 }, // 東京の値段（基準の値段 × 110円。為替に左右されない）
    USD: { name: "米ドル", interestRate: 0.03, spread: 0.005, priceFactor: 1 },
    EUR: { name: "ユーロ", interestRate: 0.025, spread: 0.008, priceFactor: 0.9 },
    GBP: { name: "英ポンド", interestRate: 0.035, spread: 0.015, priceFactor: 0.7 },
    AUD: { name: "豪ドル", interestRate: 0.045, spread: 0.01, priceFactor: 1.4 },
  },

  // ── 都市（戦闘の舞台。報酬・物価はこの通貨建て） ──
  // region: 地域（移動日数の計算に使う）
  // lon, lat: 地図上の位置（経度・緯度）。mapLabel は地図の都市名を点のどちら側に出すか（なしは下）
  // enemyWeights: その都市で出やすい敵の型（数字が大きいほど出やすい）
  // shop.weapons: その都市で買える銃、shop.discounts: 安く買える品（値段の倍率）
  // roleWeights: その都市の雇用候補に出やすい役割、rewardFactor: 任務の報酬の上乗せ（なしは1倍）
  cities: [
    {
      id: "newyork", name: "ニューヨーク", currency: "USD", region: "americas", lon: -74, lat: 40.7,
      feature: "装甲型が多い。徹甲弾が安く、盾役が見つかりやすい",
      enemyWeights: { armored: 3, swarm: 1, regen: 1, phase: 0.5 },
      shop: { weapons: ["handgun", "rifle", "heavy"], discounts: { ap: 0.7 } }, rareWeapon: "antimateriel",
      roleWeights: { shooter: 2, tank: 5, medic: 1, scout: 1 },
    },
    {
      id: "frankfurt", name: "フランクフルト", currency: "EUR", region: "europe", lon: 8.7, lat: 50.1, mapLabel: "right",
      feature: "再生型が多い。医薬品と焼夷弾が安く、衛生兵が見つかりやすい",
      enemyWeights: { armored: 1, swarm: 1, regen: 3, phase: 0.5 },
      shop: { weapons: ["handgun", "shotgun", "sniper"], discounts: { incendiary: 0.75, medkit: 0.6 } }, rareWeapon: "thermal",
      roleWeights: { shooter: 2, tank: 1, medic: 3, scout: 1 },
    },
    {
      id: "london", name: "ロンドン", currency: "GBP", region: "europe", lon: -0.1, lat: 51.5, mapLabel: "left",
      feature: "群体型が多い。散弾が安く、射手が見つかりやすい",
      enemyWeights: { armored: 1, swarm: 3, regen: 1, phase: 0.5 },
      shop: { weapons: ["handgun", "rifle", "shotgun", "sniper"], discounts: { shot: 0.7 } }, rareWeapon: "flechette",
      roleWeights: { shooter: 4, tank: 1, medic: 1, scout: 1 },
    },
    {
      id: "sydney", name: "シドニー", currency: "AUD", region: "oceania", lon: 151.2, lat: -33.9, mapLabel: "left",
      feature: "位相型が多い。共鳴弾が安く、斥候が見つかりやすい",
      enemyWeights: { armored: 1, swarm: 1, regen: 1, phase: 1.5 },
      shop: { weapons: ["handgun", "rifle", "shotgun"], discounts: { resonance: 0.7 } }, rareWeapon: "resonator",
      roleWeights: { shooter: 2, tank: 1, medic: 1, scout: 3 },
    },
    {
      // 本部。任務はない（為替が関係なくならないように）。円建てなので、買い物・雇用に換算も手数料もない
      id: "tokyo", name: "東京", currency: "JPY", region: "asia", lon: 139.7, lat: 35.7, mapLabel: "right", noMissions: true,
      feature: "こよみの本拠地。残滓の探索先はない。研究室で対抗装置を作り、日銀・財務省筋の噂を集められる。ブラックスワン顕現の地",
      enemyWeights: {},
      shop: { weapons: ["handgun", "rifle", "shotgun"], discounts: {} },
      roleWeights: { shooter: 2, tank: 2, medic: 2, scout: 1 },
    },
  ],
  homeCity: "tokyo", // スタート地点・研究室・決戦の地

  // 地域の間の移動日数（同じ地域は0日）。書いていない組み合わせは defaultDays
  //   names：地域の呼び名（ⓘの移動の説明に使う）
  travel: {
    defaultDays: 2,
    days: { "americas-europe": 1, "asia-oceania": 1 },
    names: { americas: "アメリカ", europe: "ヨーロッパ", asia: "日本", oceania: "オーストラリア" },
  },

  // ── FX口座 ──
  fx: {
    losscutRatio: 0.8, // 証拠金維持率がこれ未満でロスカット（0.8 = 80%）
    historyDays: 7, // FX口座のチャートに出す、直近の営業日の数
    minUnits: 1000, // 最小取引数量（通貨単位）
    unitStep: 1000, // 数量の刻み
    // スワップの非対称性：受け取りは控えめ、支払いは重め（両建てで利息だけ得るのを防ぐ）
    swapReceiveFactor: 0.75,
    swapPayFactor: 1.25,
    // レバレッジ上限（新しい規制から順に並べる。開始日 from 以降に適用）
    leverageRules: [
      { from: "2011-08-01", max: 25 },
      { from: "2010-08-01", max: 50 },
      { from: "0000-01-01", max: 100 }, // ゲーム用に簡略化（実際は数百倍もあった）
    ],
    // 破産判定：ポジションがなく、現金がこの額を下回ったら立て直せないとみなす（仮）
    bankruptcyThreshold: 30_000,
  },

  // ── 現地通貨の支払い・受け取り（自動換算） ──
  settlement: {
    conversionFee: 0.01, // 換算手数料 1%
  },

  // ── 出撃の試作用（FXラボだけで使う仮の値。現地通貨建て） ──
  dummySortie: {
    ammoCost: { USD: 100, EUR: 90, GBP: 75, AUD: 150 },
    reward: { USD: 350, EUR: 300, GBP: 250, AUD: 500 },
    dayOptions: [1, 2, 3],
  },

  // ── 戦闘（すべて仮の値。自動プレイで調整する） ──
  battle: {
    tick: 0.05, // 1回の計算で進める秒数
    maxSeconds: 45, // これを過ぎたら時間切れ（報酬なしで撤退扱い）
    bossMaxSeconds: 90, // 決戦の各形態の時間切れ（時間切れは敗北）
    damageVariance: 0.15, // ダメージのぶれ（±15%）
    accuracy: 0.85, // 味方の命中率（銃ごとに accuracy があればそちらを使う）
    crit: { chance: 0.08, multiplier: 2 }, // 味方の会心
    enemyStrike: { chance: 0.1, multiplier: 2.5 }, // 敵の強撃（まれに大きなダメージ）
    // 敵の手強さのぶれ（体力と攻撃力）。group は戦闘ごとの群れ全体、individual は1体ごと
    // 戦闘ごとにまとまってぶれるので、同じ条件でも勝ったり負けたりする
    strengthVariance: { group: 0.2, individual: 0.1 },
    fallback: { damage: 3, interval: 0.5 }, // 弾切れ後の近接攻撃
    stageRecovery: 0.25, // 任務の戦闘と戦闘の間に、生き残った仲間が回復する割合（最大体力に対して）
    ambushBonus: 0.2, // 偵察した任務の最初の戦闘で、部隊の攻撃力が上がる割合（奇襲）
    predictionRuns: 300, // 勝率予測で裏で戦わせる回数
    unscoutedCandidates: 12, // 偵察前に想定する敵の編成の数（勝率に幅を出すため）
  },

  // ── レベル ──
  //   敵：体力・攻撃力 × enemyGrowth^(Lv-1)
  //   仲間：体力 × allyGrowth^(Lv-1)、ほかに命中・回避・撃つ速さが少しずつ上がる（訓練で上げる。攻撃力は上がらない）
  //   銃：攻撃力 × allyGrowth^(Lv-1)（銃の種類ごと。お金で強化する。同じ種類の銃はすべて同じレベル）
  //   上げ幅は味方のほうが大きい：全員・全部の銃が敵と同じレベルで、合う弾を持っていれば負けない。
  //   敵が3〜4レベル上なら、弾を揃えても負ける
  levels: {
    enemyGrowth: 1.15,
    allyGrowth: 1.155,
    member: { maxLevel: 25, accuracy: 0.004, evade: 0.003, speed: 0.997 }, // 1レベルごと：命中+0.4%、回避+0.3%、撃つ間隔×0.997
    weapon: { maxLevel: 25, basePrice: 60, growth: 1.32 }, // 強化の値段（基準の値段）= basePrice × growth^(いまのLv-1) × 銃の格（price÷300 の平方根）
    // 任務の敵のレベル = 1 + 周回の進み具合 × perRun ＋ 規模ごとの補正 ＋ ばらつき（-1〜+1）
    mission: { perRun: 10, tierOffset: { 1: -1, 2: 0, 3: 1 }, special: 1, spread: [-1, 0, 0, 1], max: 15 },
    rewardPerLevel: 0.07, // 報酬 ×（1 ＋ これ ×（Lv-1））
  },

  // 弾の方針
  ammoPolicies: {
    smart: "特効弾は効く敵にだけ使う",
    allOut: "特効弾を惜しまず使う",
    normalFirst: "通常弾で済む敵には通常弾",
  },

  // 弾の種類。price は1発の基準の値段（米ドル相当。現地では priceFactor を掛ける）
  ammoTypes: {
    normal: { name: "通常弾", price: 0.08 },
    ap: { name: "徹甲弾", price: 0.45 },
    shot: { name: "散弾", price: 0.35 },
    incendiary: { name: "焼夷弾", price: 0.45 },
    resonance: { name: "共鳴弾", price: 3 },
  },

  // 弾以外の消耗品
  supplies: {
    medkit: { name: "医薬品", price: 3 }, // 衛生兵が1回回復するごとに1個使う
  },

  // 銃。price は基準の値段（現地では priceFactor を掛ける）。damage は1発の攻撃力、interval は撃つ間隔（秒）、targets は1回で当たる敵の数
  // row: 前列・後列に置いたときの攻撃力の倍率
  weapons: {
    // rows：使える列（なければどちらでも）。accuracy：命中率。crit：会心率の上乗せ。evade：持ち主の回避の上乗せ
    // saveAmmo：弾を使わずに撃てる確率。splash：2体目以降に当たる攻撃力の割合。pierce：効きにくい弾でも攻撃力が落ちない
    // draw：前列・誰でもを狙う敵に、狙われやすくなる確率（目立つ）。desc：画面の説明
    handgun: {
      name: "ハンドガン", price: 60, damage: 8, interval: 0.3, targets: 1, evade: 0.08, saveAmmo: 0.3,
      desc: "軽い。持ち主が攻撃をかわしやすく（回避+8%）、弾を3割節約できる。攻撃力は低い",
    },
    rifle: { name: "アサルトライフル", price: 300, damage: 10, interval: 0.18, targets: 1, accuracy: 0.93, desc: "よく当たる（命中93%）、安定した万能の銃" },
    shotgun: {
      name: "ショットガン", price: 350, damage: 12, interval: 0.45, targets: 3, splash: 0.6, rows: ["front"],
      desc: "前列専用。近くの3体にまとめて当たる（2体目以降は6割）。群れに強い",
    },
    sniper: {
      name: "スナイパーライフル", price: 600, damage: 55, interval: 1.0, targets: 1, accuracy: 0.8, crit: 0.15, pierce: 0.85, rows: ["back"],
      focus: "toughest", desc: "後列専用。一番体力の多い敵を狙う。会心が出やすく、効きにくい弾でも攻撃力があまり落ちない",
    },
    heavy: {
      name: "重火器", price: 1500, damage: 9, interval: 0.06, targets: 1, accuracy: 0.8, draw: 0.3, evade: -0.1,
      desc: "弾をばらまき、攻撃力は高い。弾をとても多く使う。重くて目立つので、狙われやすく、かわしにくい",
    },
    // 特殊な銃（店では買えない。各都市の特異な残滓の報酬）。ammoAs：通常弾を使っても、その弾として効く
    antimateriel: {
      name: "対物ライフル", rare: true, damage: 55, interval: 0.6, targets: 1, accuracy: 0.9, crit: 0.15, ammoAs: "ap",
      rows: ["back"], pierce: 0.9, desc: "後列専用。通常弾でも徹甲弾として効く。攻撃力が高く会心も出やすく、効きにくい相手にも攻撃力がほとんど落ちない",
    },
    flechette: {
      name: "フレシェット砲", rare: true, damage: 15, interval: 0.4, targets: 5, ammoAs: "shot", saveAmmo: 0.3,
      rows: ["front"], splash: 0.8, desc: "前列専用。通常弾でも散弾として効き、5体にまとめて当たる（2体目以降は8割）。弾を3割節約できる",
    },
    thermal: {
      name: "焼夷放射器", rare: true, damage: 17, interval: 0.22, targets: 3, ammoAs: "incendiary",
      rows: ["front"], splash: 0.8, desc: "前列専用。通常弾でも焼夷弾として効き、3体にまとめて当たる（2体目以降は8割）",
    },
    // 株主優待で届く、研究所の試作品（店では買えない）
    prototype: {
      name: "試作位相銃", rare: true, damage: 15, interval: 0.22, targets: 1, accuracy: 0.92, pierce: 0.9,
      desc: "研究所の試作品（株主優待で届く）。よく当たり、どの弾でも、効きにくい相手への攻撃力がほとんど落ちない",
    },
    resonator: {
      name: "共鳴砲", rare: true, damage: 40, interval: 0.7, targets: 1, accuracy: 0.92, ammoAs: "resonance", pierce: 0.85,
      desc: "通常弾でも共鳴弾として効く。よく当たり、効きにくい相手にも攻撃力があまり落ちない",
    },
  },

  // 役割。reduction は受けるダメージの軽減率、taunt は前列を狙う敵に狙われやすさ
  // 衛生兵は、体力が healBelow 未満の仲間がいるとき、医薬品を1個使って heal だけ回復する
  // wage は日給（基準の値段。雇った都市の通貨で毎日払う。2026-11-02に約1.75倍に上げた。射手の56は、東京で6,160円）
  // weapons は雇ったときに持っている銃の候補
  // name は役割の名前、note は雇用候補・部隊に出る補足（なしは出さない）
  roles: {
    hero: { name: "観測者", note: "残滓を観測・固定する", hp: 200, damage: 1.3 }, // こよみは体力と攻撃力が高め（最序盤に1〜2人雇えば小規模の任務に勝てるように）
    // 射手：特効の弾が当たると、攻撃力がさらに counterBonus 倍（弾の選び方が上手い役割）
    shooter: { name: "射手", note: "弱点を突く：特効の弾の攻撃力がさらに1.25倍", hp: 100, counterBonus: 1.25, wage: 56, weapons: ["rifle", "shotgun", "sniper"] },
    tank: { name: "盾役", note: "前列で敵を引きつける", hp: 220, reduction: 0.4, taunt: 0.7, wage: 63, weapons: ["handgun", "shotgun"] },
    medic: { name: "衛生兵", note: "医薬品で仲間を回復", hp: 90, heal: 35, healInterval: 1.5, healBelow: 0.7, wage: 63, weapons: ["handgun"] },
    scout: { name: "斥候", note: "偵察が早くなる、攻撃をかわす", hp: 90, evade: 0.15, wage: 45, weapons: ["handgun"] },
  },

  // 仲間の特性。数字は倍率（hp: 1.25 = 体力1.25倍）か、足し算（accuracy: 0.08 = 命中率+8%）
  //   戦闘：hp, damage, interval（撃つ間隔）, accuracy, crit（会心率）, evade（回避率）, saveAmmo（弾を使わずに済む確率）
  //   町：wage（日給）, discount（地元の都市での買い物の割引）, feeCut（部隊全体の換算手数料の軽減）
  traits: {
    quickdraw: { name: "早撃ち", desc: "撃つのが速い", interval: 0.85 },
    sturdy: { name: "頑丈", desc: "体力が多い", hp: 1.25 },
    marksman: { name: "名射手", desc: "よく当たり、会心が出やすい", accuracy: 0.08, crit: 0.06 },
    veteran: { name: "歴戦", desc: "体力と攻撃力が高いが、日給も高い", hp: 1.1, damage: 1.12, wage: 1.4 },
    nimble: { name: "身軽", desc: "攻撃をかわしやすい", evade: 0.12 },
    thrifty: { name: "弾の節約", desc: "ときどき弾を使わずに撃つ", saveAmmo: 0.2 },
    frugal: { name: "倹約家", desc: "日給が安い", wage: 0.7 },
    fixer: { name: "地元の顔役", desc: "雇った都市での買い物が安い", discount: 0.15 },
    changer: { name: "両替上手", desc: "部隊の換算手数料が半分になる", feeCut: 0.5 },
  },

  // ── 部隊・町 ──
  party: {
    // こよみ（主人公）。origin は出自（部隊タブに出る）
    hero: { name: "こよみ", age: 22, sex: "female", origin: "\"天狐\"" },
    maxMembers: 6, // 出撃する編成の人数の上限（主人公を含む）
    maxRoster: 10, // 雇える人数の上限（主人公を含む）。編成に入らない仲間も日給はかかる
    // 雇用候補のLv＝仲間の平均Lv ＋ ばらつき（hireLevelSpread から選ぶ）。日給は ×（1 ＋ wagePerLevel ×（Lv-1））
    hireLevelSpread: [-2, -1, -1, 0, 0, 1],
    wagePerLevel: 0.05, // 2026-11-02：日給の元の値を上げたので、Lvによる上がり方は0.1→0.05に
    heroWeapon: "rifle", // 主人公が最初に持っている銃
    startCandidates: ["tank", "medic"], // 最初の都市の最初の週の雇用候補（残りはランダム）
    ageRange: [18, 35], // 雇用候補の年齢（生まれた年代で名前を選ぶ）
    startAmmo: { normal: 400 }, // 最初に持っている弾
    startMedkits: 5,
    candidatesPerCity: 3, // 都市ごとの雇用候補の数
    candidateRefreshDays: 7, // 雇用候補が入れ替わる間隔（日）
    origins: ["元軍人", "民間の警備員", "研究者", "元警察官", "傭兵"], // 仲間の出自（表示用）
    traitCount: [1, 2], // 仲間が持つ特性の数（最小・最大）
    severanceDays: 10, // 解雇するときの退職金：いまの日給のこの日数分（雇った都市の通貨で。未払いの日給があれば、それも払う）
    scoutDays: 2, // 偵察にかかる日数
    scoutDaysWithScout: 1, // 斥候がいるときの偵察の日数
    wageGraceDays: 3, // 日給の未払いがこの日数続くと、その仲間は去る
    injuryDays: 3, // 戦闘不能になった仲間が回復するまでの日数（勝利・撤退のとき）
    deathChanceOnFall: 0.25, // 戦闘で倒れた仲間（こよみ以外）が死亡する確率。撤退ラインで退いた仲間は死なない
    heroWipeInjuryDays: 3, // こよみが倒れたとき、回復するまでの日数
    // 訓練：町で待機・偵察する日に、1日あたり fee ×（いまのLv）（基準の値段）を払う。daysPerLevel 日でLvが1上がる
    //   出撃した日も、出た仲間は sortieXp 日分の訓練になる（お金はかからない）
    //   2026-11-02：お金が決戦の強さに効くよう、町の訓練を「値段×2・効果×3」にした（fee 11→22、daysPerLevel 3→1）。
    //   出撃の経験でのLvの上がり方は変えない（sortieXp 0.25→1/12。daysPerLevel が1/3になったぶん）
    training: { fee: 22, daysPerLevel: 1, sortieXp: 1 / 12 },
    retreatRewardShare: 0.5, // 途中で撤退したとき、突破した戦闘の割合 × これだけ報酬を受け取る
  },

  // ── 手がかり（FXの判断材料） ──
  hints: {
    // 偵察すると、その都市の通貨の、この先 days 日の向きの噂が聞ける（accuracy の確率で正しい。観測レンズで上がる：lens[].scoutAccuracy）
    scout: { days: 7, accuracy: 0.85 },
    // 東京で情報を集める（takeDays 日）：4通貨のうち、この先 days 日で一番大きく動く通貨と、その向きの噂（向きは accuracy の確率で正しい）
    //   一度集めると、cooldownDays 日たつまで新しい噂は入らない。strongMove 以上動くなら「大きく」
    //   2026-11-02：円全体の向き（7日・80%・週に1度）から変えた。クールタイム10日ではFXだけで東京に居続ける戦略が46%クリアしたので15日に
    tokyo: { days: 10, accuracy: 0.85, takeDays: 1, cooldownDays: 15, strongMove: 0.02 },
    // 記憶の断片：周回の期間に、相場を動かした実際の出来事があると、recallChance の確率で思い出す（src/data/events.js）
    //   思い出したものは正確（何が起き、どの通貨がどちらに動いたか）。時期は旬（上旬・中旬・下旬）まで
    //   recallDays: 出来事のこの日数前に思い出す。effectDays: 出来事の前日から何日後までの値動きを「影響」とするか
    //   名前のある出来事のほか、bigMove 以上の値動き（effectDays 日で）も「相場が大きく動いた出来事」として扱う（gapDays 以上離す）
    memory: { effectDays: 10, bigMove: 0.03, recallDays: 30, recallChance: 0.8, gapDays: 10 },
  },

  // ── 特異な残滓（期限付き。種類ごとの見返りがある。位相残晶は凝相の残滓でだけ手に入る） ──
  specials: {
    everyDays: 8, // この日数ごとに1つ現れる
    lifeDays: 12, // 現れてから受けられる日数
    // 観測レンズを強化していると見つかる、追加の特異な残滓（黄金の残滓は出ず、レンズで増える種類だけ）
    //   lens：その段階以上のレンズで見つかる。offset 日目から everyDays 日ごと
    lensExtra: [
      { lens: 1, offset: 6, everyDays: 12 },
      { lens: 3, offset: 10, everyDays: 12 },
    ],
    // 特異な残滓の種類。lens：観測できるようになる観測レンズの強化回数（0は最初から）
    //   rewardMult：売却額の倍率（売却額そのものが見返りの種類だけ。なしは1倍）、weapon：その都市の特殊な銃が手に入る、levelBonus：敵のLvの上乗せ
    //   feathers：勝つと手に入る位相残晶の数の範囲（現れたときに決まる。これがない種類では位相残晶は手に入らない）
    //   xp：勝つと、出撃した仲間（こよみも）が得る経験（訓練の日数。party.training.daysPerLevel 日でLv1つ）
    //   現れたときに、観測できる種類から等しい確率で決まる（特殊な銃は、その都市の銃をまだ持っていないときだけ）
    //   レンズで増える種類は、それぞれの報酬がある（強化したほうが得）
    //   2026-11-02：売却額の倍率は黄金の残滓だけにした（ほかは見返りが別にあるので）
    kinds: {
      cash: { name: "黄金の残滓", lens: 0, rewardMult: 1.3, desc: "売却額が大きい" },
      rare: { name: "鉄火痕の残滓", lens: 1, weapon: true, desc: "倒すと残留物から作られた特殊な銃が手に入る" },
      echo: { name: "群星の残滓", lens: 1, xp: 1, desc: "戦った仲間が成長する（全員Lv1つ分の経験）" },
      crystal: { name: "凝相の残滓", lens: 2, feathers: [12, 18], desc: "位相残晶がまとめて手に入る" },
      pure: { name: "高純度の残滓", lens: 3, levelBonus: 2, xp: 2, desc: "戦った仲間が大きく成長する（Lv2つ分）。ただし敵がとても強い（そのぶん売却額も大きい）" },
    },
    strength: 1.0, // 敵の重さの倍率（大規模の任務を基準に）。敵のレベルは大規模より levels.mission.special だけ高い
  },

  // 敵の型（数値はレベル1のとき）。mods は弾ごとのダメージ倍率（書いていない弾は1倍）
  //   target は狙い方：front（前列。盾役が引きつける）、any（誰でも）、weakest（一番弱っている仲間）
  //   特効は3倍、効かない弾は0.5倍、特殊弾が合わない相手には0.75倍（通常弾のほうが割安になる）
  // points は任務の規模（予算）に対する重さ、pack は群れの数、minTier はその規模以上の任務にだけ出る
  // regen は1秒あたりの回復量（焼夷弾が当たってから burnSeconds 秒は止まる）
  enemyTypes: {
    armored: {
      name: "装甲型", hp: 1760, attack: 4.1, interval: 0.8, points: 100, target: "front",
      mods: { ap: 3, normal: 0.5, shot: 0.5, incendiary: 0.75, resonance: 0.75 },
    },
    swarm: {
      name: "群体型", hp: 200, attack: 1.4, interval: 0.5, points: 14, pack: [5, 8], target: "any",
      mods: { shot: 3, incendiary: 3, ap: 0.5, resonance: 0.75 },
    },
    regen: {
      name: "再生型", hp: 1280, attack: 3.6, interval: 0.7, points: 90, regen: 96, burnSeconds: 1.5, target: "front",
      mods: { incendiary: 3, ap: 0.75, shot: 0.75, resonance: 0.75 },
    },
    phase: {
      name: "位相型", hp: 2080, attack: 5, interval: 0.9, points: 150, minTier: 2, target: "weakest",
      mods: { resonance: 3, normal: 0.5, ap: 0.5, shot: 0.5, incendiary: 0.5 },
    },
    // ブラックスワンの各形態（決戦だけに出る。boss: true は任務には出ない）
    //   portrait：決戦の画面で、体力バーの上に出す立ち絵
    swanWing: {
      name: "ブラックスワン（装甲）", boss: true, portrait: "assets/bosses/armor.webp", hp: 26600, attack: 11.2, interval: 0.6, points: 0, target: "front",
      mods: { ap: 3, normal: 0.5, shot: 0.5, incendiary: 0.75, resonance: 0.75 },
    },
    swanBody: {
      name: "ブラックスワン（再生）", boss: true, portrait: "assets/bosses/regeneration.webp", hp: 19650, attack: 9.8, interval: 0.5, points: 0, regen: 740, burnSeconds: 1.5, target: "any",
      mods: { incendiary: 3, ap: 0.75, shot: 0.75, resonance: 0.75 },
    },
    swanCore: {
      name: "ブラックスワン（位相）", boss: true, portrait: "assets/bosses/phase.webp", hp: 21000, attack: 13, interval: 0.7, points: 0, target: "weakest",
      mods: { resonance: 3, normal: 0.5, ap: 0.5, shot: 0.5, incendiary: 0.5 },
    },
  },

  // 観測レンズ（東京で強化する）。段階が上がるほど、観測できる特異な残滓の種類が増え、
  //   すべての探索（特異な残滓も）の回収品の売却額と、位相残晶の数が増える
  //   lensBaseName：最初から持っているレンズ（1段階目）の名前。lens：強化先（2段階目〜）
  lensBaseName: "観測レンズ Mk.I",
  lens: [
    // yen：費用（円）、feathers：使う位相残晶の数
    // rewardBonus：売却額の上乗せ（0.1 = +10%）、featherBonus：位相残晶の上乗せ（確実に拾う数と、1日ごとの上乗せの確率に掛かる。凝相の残滓の数にも）
    // scoutAccuracy：偵察で聞く噂の確からしさ（最初のレンズは hints.scout.accuracy）
    { name: "観測レンズ Mk.II", yen: 40_000, feathers: 2, rewardBonus: 0.1, featherBonus: 0.15, scoutAccuracy: 0.88 },
    { name: "観測レンズ Mk.III", yen: 80_000, feathers: 4, rewardBonus: 0.2, featherBonus: 0.3, scoutAccuracy: 0.92 },
    { name: "観測レンズ Mk.IV", yen: 150_000, feathers: 6, rewardBonus: 0.3, featherBonus: 0.5, scoutAccuracy: 0.96 },
  ],

  // ── 決戦・クリア条件（自動プレイで調整する） ──
  endgame: {
    // 位相残晶（対抗装置・観測レンズの素材）：特異な残滓以外の探索に勝つと手に入る
    //   最低保証 = 日数 × perDay × レンズの補正（切り上げ）。さらに1日ごとに bonusChance × レンズの補正 の確率で1個上乗せ
    //   特異な残滓では、凝相の残滓（specials.kinds.crystal.feathers）を除いて手に入らない
    //   2026-11-02：レンズの補正を入れたので、元の値を下げた（0.5→0.4、30%→25%）
    feathers: {
      perDay: { 1: 0.4, 2: 0.4, 3: 0.4 },
      bonusChance: 0.25,
    },
    // 対抗装置：段階ごとにブラックスワンへの備えが増える（なくても挑めるが、とても不利）。研究室で頼むとその場で完成する
    //   段階ごとの建造費（円）と必要な位相残晶。お金はほとんどかからず、位相残晶（敵を倒さないと手に入らない）が主
    //   rules：その段階から有効になる決戦の規則（前の段階のものも残る）
    //   missing：その段階がないときの不利（決戦タブ・確認に出す）。[文の途中の形, 文の終わりの形]。複数あれば「、」でつなぐ
    device: [
      {
        name: "共振コイル", yen: 30_000, feathers: 10, rules: { specialAmmo: true }, field: { special: 1.1 }, fieldDesc: "特効が1割強くなる",
        desc: "特効弾がブラックスワンに効くようになる（なければ特効は入らない）", missing: ["特効弾が効かず", "特効弾が効かない"],
      },
      {
        name: "位相安定器", yen: 50_000, feathers: 15, rules: { regen: false, targetAny: true }, field: { regen: 0.7, weakest: 0.45 }, fieldDesc: "再生型の再生が遅くなり、位相型が弱った仲間を狙いにくくなる",
        desc: "特殊な力を抑える：再生が止まり、弱った仲間を狙い撃ちしなくなる",
        missing: ["第2形態が再生し、第3形態が弱った仲間を狙い撃ちし", "第2形態が再生し、第3形態が弱った仲間を狙い撃ちする"],
      },
      {
        name: "対抗装置・本体", yen: 80_000, feathers: 20, rules: { damageTaken: 1 }, field: { damage: 1.05 }, fieldDesc: "攻撃力が少し上がる",
        desc: "殻を破る：与えるダメージが本来の大きさになる（なければ半分）", missing: ["与えるダメージが{damageTaken}%になり", "与えるダメージが{damageTaken}%になる"], // {damageTaken} は bossRulesBase から
      },
    ],
    // 対抗装置がないときの決戦の規則
    bossRulesBase: { specialAmmo: false, regen: true, targetAny: false, damageTaken: 0.5 },
    // 研究所の株式（資金ルート）。1%ずつ買う。1%の値段 = firstPrice × 期間の補正 × 節目の倍率
    //   steps：保有比率が at% に届くと、それ以降の値段が mult 倍になる（重ねて掛かる）
    shares: {
      foundation: "株式会社東亜ホールディングス先端技術研究所", // ストーリーで使う正式名
      shortName: "研究所", // 画面での略称（「研究所の株式」など）
      research: "未実現可能性の現実固着研究", // 研究所の研究の名前（ブラックスワン顕現の原因。ストーリー・資金ルートのエンディングで使う）
      firstPrice: 22_400, // 2026-11-02：1.8万→2万円。2026-11-03：FXだけで過半数に届きすぎたため2.24万円に（ボスLvを1下げる値段は2万円のときの1.12倍）。あわせて30%の節目の倍率 2.5→3.5
      steps: [
        { at: 5, mult: 1.5, title: "大量保有報告書", text: "保有が5%を超え、大量保有報告書を出した。買い集めが市場に知られ、株価が上がった" },
        { at: 30, mult: 3.5, title: "公開買付け", text: "30%を超えた後は公開買付けが必要になる。市場の値段にプレミアムを上乗せして買い取る" },
      ],
      majority: 51, // これ以上でクリア（画面には出さない隠し条件）
      // 期間の補正：周回の期間に相場が大きく動いた（稼ぎやすい）ほど値段を上げる
      // 補正 = 1 + trendFactor × （4通貨のうち、期間中の変化率が一番大きいものの絶対値）
      trendFactor: 1.5,
      // 時期の補正：研究が進むほど株価が上がる。値段 ×（1 ＋ priceGrowth × 周回の進み具合）。期日には ×1.3（早く買うほど安い）
      priceGrowth: 0.3,
      // 配当：毎月1日に、株式に払った額の dividendMonthly を受け取る（年12%。現実の配当より高めなので、これ以上は上げない）
      dividendMonthly: 0.01,
      // 株主優待：保有比率に応じて、造兵廠（弾・医薬品・銃）の割引と、毎月1日の現物の配当（銃の強化は割引にならない）
      //   weapon：その段階に届いたとき、一度だけ現物で届く銃（Lvはそのときの敵の基準Lv）
      perks: [
        { at: 5, discount: 0.05, gift: { medkit: 10 } },
        { at: 10, discount: 0.08, gift: { medkit: 12 }, weapon: "prototype" },
        { at: 15, discount: 0.1, gift: { medkit: 15, resonance: 100 } },
        { at: 30, discount: 0.15, gift: { medkit: 20, resonance: 200, ap: 200 } },
      ],
    },
    // ブラックスワンの形態（決戦の戦闘。上から順に戦う）
    bossForms: [
      { name: "第1形態：装甲", enemies: [{ type: "swanWing" }, ...Array(8).fill({ type: "swarm" })] },
      { name: "第2形態：再生", enemies: [{ type: "swanBody" }, { type: "armored" }, { type: "armored" }] },
      { name: "第3形態：位相", enemies: [{ type: "swanCore" }, { type: "phase" }] },
    ],
    stageRecovery: 0.25, // 形態と形態の間の回復
    // ブラックスワン（取り巻きを含む）のレベル。そのままでは勝てない高さで、株式を持つと研究が遅れて下がる
    //   想定：株式を20〜30%持ち（資金ルートの過半数には遠い）、部隊をLv14前後まで鍛えて、ちょうど戦える
    bossLevel: 20, // 2026-11-02：18→19（FXなしのクリア率を下げるため）。2026-11-03：キリよく20に（強さは bossScale で19のときと同じ）
    // ブラックスワン（取り巻きを含む）の体力・攻撃力の倍率。1 / enemyGrowth で、Lvが1つ下のときと同じ強さになる
    bossScale: 1 / 1.15,
    sharesPerBossLevel: 5, // 株式を何%買うごとに、ボスのレベルが1下がるか（買った量の合計で数える。上限なし）
    // 決戦に持っていく弾の目安（決戦タブに出す）：game.finalAmmoGuide() が、仲間は傷つかないものとして、いまの部隊・銃・ボスのLv・
    //   対抗装置で3つの形態を倒しきるまで guideRuns 回戦わせ、guideCover の割合の回が足りる量（勝ち負けは出さない）
    //   guideSeconds 秒で倒しきれない回が多いとき、またはどれかの弾が guideMax 発を超えるときは「推測不能」
    guideRuns: 30,
    guideCover: 0.8,
    guideSeconds: 300,
    guideMax: 9900,
    // 決戦に持っていく弾・医薬品の固定の目安（これまでの自動プレイ tools/bots.js の決戦の準備だけで使う。画面には出さない）
    ammoGuide: { normal: 1500, ap: 1600, incendiary: 1100, resonance: 1000, medkit: 60 },
  },

  // 任務の規模。中身はランダム：stageCount は戦闘の回数、stageBudget は1戦ごとの敵の重さ、days は日数の範囲
  // 報酬（基準の値段）＝ rewardPerPoint × 敵の重さの合計 ×（日数 ÷ 最短の日数）^0.5 × レンズの補正（現地では priceFactor を掛ける）
  // 2026-11-02：日給を上げたので元の値も1.3倍にした（日給に対する割合では下げ、レンズで取り戻す形）
  missionTiers: [
    { tier: 1, name: "小規模", stageCount: [1, 1], stageBudget: [260, 340], days: [2, 3], rewardPerPoint: 2.28 },
    { tier: 2, name: "中規模", stageCount: [1, 2], stageBudget: [400, 520], days: [3, 6], rewardPerPoint: 1.82 },
    { tier: 3, name: "大規模", stageCount: [2, 3], stageBudget: [450, 600], days: [6, 10], rewardPerPoint: 2.1 },
  ],

  // ── 相場 ──
  market: {
    intradaySteps: 96, // 1日を何コマに分けて補間するか（96 = 15分刻み）
    volLookback: 20, // 日中の揺れの大きさを、直近何営業日の変動から推定するか
    intradayVolScale: 1.0, // 日中の揺れの強さの倍率（演出の調整用）
    defaultDailyVol: 0.006, // データが少ないときの1日の変動率の仮値
  },

  // ── データ ──
  data: {
    ratesUrl: "data/rates.json",
    newsUrl: "data/news.json", // 画面の端に流すニュース（tools/fetch-news.html で作る。なければニュースは出ない）
  },

  // ── 画面の端に流すニュース（世界観の演出。src/ui/news.js） ──
  //   ゲーム内の日付の、実際の出来事（ウィキペディア日本語版の年・日付の記事から）を、日付（M/D）を付けて画面の下の端に流し続ける。
  //   ゲーム内の日付より後の出来事は、決して出さない
  //   minItems：その日の出来事がこれより少ないときだけ、前日、2日前、3日前（lookbackDays 日前まで）の出来事を足す。
  //     それでも足りなくても、それ以上は遡らず、ほかのもので補わない。取得ツールの記録の「足りない日」も、この数で数える
  //     目安：1件は40〜60字。speed（1秒あたりの画素）42 で、スマホの幅では1件が約15秒で流れる
  //   listPerDay：一覧から作った項目（番組の開始・終了、曲の発売など）は、1日にこの数まで（足りないときだけ残りも流す）
  //   gap：項目と項目のあいだ（画素）
  news: {
    minItems: 3,
    lookbackDays: 3,
    listPerDay: 3,
    speed: 42,
    gap: 56,
  },

  // ── 画面で使う絵 ──
  ui: {
    gameTitle: "BLACK SWAN", // タイトル画面・ゲーム画面の最上部に出す作品名
    version: "1.0.0", // 版（画面には出さない）。オフライン用の保存（sw.js の VERSION）と同じ値にする
    // 免責事項（タイトル画面の「免責事項」で開く。1要素が1段落）
    disclaimer: [
      "本作は、現実の歴史・経済・金融市場等を題材の一部としたフィクションです。実在する地名、通貨、企業、団体、出来事、過去の市場データ等が登場する場合がありますが、物語、登場人物およびゲーム上の設定には創作・脚色が含まれます。",
      "本作には、外国為替証拠金取引（FX）や株式取引を題材としたゲームシステムが含まれています。これらはゲームとして簡略化・調整されており、実際の取引を完全に再現するものではありません。また、本作に含まれる情報は、特定の金融商品について投資を推奨し、または投資判断に関する助言を行うことを目的としたものではありません。",
      "実際のFXその他の金融取引には、価格・為替・金利の変動やレバレッジ等により損失が生じるリスクがあり、取引の条件によっては預け入れた資金を超える損失が発生する場合があります。",
      "ゲーム内に登場する相場、ニュース、経済事象、取引条件、損益その他の情報には、ゲーム上の演出・調整・創作が含まれる場合があります。実際の投資判断には使用せず、実際の取引はご自身の判断と責任において行ってください。",
    ],
    // 出典（タイトル画面の「出典」と、ニュースの帯の「出典」で開く）。title：見出し、text：本文（1要素が1段落）、links：[表示, URL]
    //   ニュースの記事名の一覧は、data/news.json の pages から自動で足す
    credits: [
      {
        title: "画面の端に流れるニュース",
        text: [
          "ウィキペディア日本語版の各記事（年の記事「○○年」、日付の記事「○月○日」、「○○年のスポーツ」など）の「できごと」から作成しています。",
          "文章はクリエイティブ・コモンズ 表示-継承 4.0 国際（CC BY-SA 4.0）で提供されています。ゲームに合わせて、文の一部を省略し、文末を見出しの形にそろえ、出来事の名前（後から付けられた事件・災害の名前など）を中身の説明に置き換えるなどの改変をしています。改変した文章も CC BY-SA 4.0 です。",
          "記事の執筆者は、各記事の履歴から確認できます。",
          "出来事の少ない日には、英語版ウィキペディアや公的機関・報道の記録で日付を確かめた出来事を、短い文で書き足しています。",
        ],
        links: [
          ["ウィキペディア日本語版", "https://ja.wikipedia.org/"],
          ["CC BY-SA 4.0 の内容", "https://creativecommons.org/licenses/by-sa/4.0/deed.ja"],
        ],
      },
      {
        title: "為替レート",
        text: ["欧州中央銀行（ECB）の参考レートを、Frankfurter API を通じて取得しています。"],
        links: [["Frankfurter", "https://frankfurter.dev/"]],
      },
      {
        title: "世界地図",
        text: ["陸地の形は Natural Earth（パブリックドメイン）のデータを、world-atlas を通じて使っています。"],
        links: [["Natural Earth", "https://www.naturalearthdata.com/"]],
      },
    ],
    heroPortrait: "assets/portraits/koyomi/normal.webp", // 部隊タブのこよみの立ち絵
    // 移動の演出のちびキャラ（東へ＝右へ進むときは right、西へ＝左へ進むときは left）
    travelChibi: { right: "assets/chibi/koyomi/run_right.webp", left: "assets/chibi/koyomi/run_left.webp" },
    travelMs: 2200, // 移動の演出の長さ（ミリ秒。押すと飛ばせる）
  },

  // ── ストーリー（会話の画面）。台本は src/data/story.js、絵は assets/ ──
  story: {
    typeMs: 35, // 1文字を出す間隔（ミリ秒）。0にすると一度に全部出る
    autoBaseMs: 1200, // オート送り：文を出し終えてから次へ進むまでの基本の待ち時間
    autoPerCharMs: 70, // オート送り：1文字ごとに足す待ち時間
    fadeMs: 500, // 背景（黒画面・スチル・ゲーム画面）の切り替えの時間
    rewindMs: 3200, // 日付が遡る演出の長さ
    rewindYearsAfter: 5, // 演出の始まり：ドゥームズデイの何年後か（月日はランダム）
  },
};
