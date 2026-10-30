// ストーリー（会話）の台本
//
// 1つの場面は「手順」の配列。手順は次のどれか：
//   { who, face, text }  … 台詞。who は SPEAKERS のキー（ns：発言者・立ち絵なし、system：立ち絵なし）
//                          face は立ち絵の表情（assets/portraits/<who>/<face>.webp）
//   { bg }               … 背景を変える。"black"（黒画面）／ STILLS のキー（スチル）／ "game"（ゲーム画面）
//   { tab }              … ゲーム画面にして、そのタブを開く（final／town／fx／map／party）
//   { rewind: true }     … 日付が遡る演出（ドゥームズデイの5年後のどこか → 開始日）
//
// 文の中の書き方：
//   {名前}          … ゲームの状態や設定から入る値（STORY_VARS を参照）
//   ｜漢字《かな》  … ルビ（｜から《までの文字に、《》の中のふりがなを振る）
//   \n              … 改行
//
// 文字数の多い説明（システム）は、箱に収まるよう文の切れ目で分けてある。

export const SPEAKERS = {
  ns: {}, // 地の文：発言者の名前も立ち絵も出さない
  system: { name: "システム" }, // 立ち絵なし
  koyomi: { name: "{hero}", portraits: "assets/portraits/koyomi/" },
};

export const STILLS = {
  intro: "assets/stills/intro.webp",
  timeleap: "assets/stills/timeleap.webp",
  victory: "assets/stills/victory.webp", // エンド1：ブラックスワンを倒した
  stock: "assets/stills/stock.webp", // エンド2：財団の株式の過半数（真エンド）
  defeat: "assets/stills/defeat.webp", // エンド3：決戦に敗れた
  bankrupt: "assets/stills/bankrupt.webp", // エンド4：破産
};

// 周回の終わり方 → エンディングの場面（STORY のキー）。結果の画面の前に流れる
//   キーは game.over（reason が "clear" なら route、それ以外は reason）
export const ENDING_STORY = {
  battle: "victory",
  funds: "stock",
  bossDefeat: "defeat",
  bankrupt: "bankrupt",
};

export const STORY = {
  // 「始める」を押した直後（ストーリー＋チュートリアル）
  intro: [
    { bg: "black" },
    { who: "ns", text: "{futureYear}年。世界は滅びた。" },
    { who: "ns", text: "突如として顕現した「それ」は、世界のすべてを刹那のうちに消し去った。" },
    { who: "koyomi", face: "battle_defeated", text: "ブラックスワン......" },
    { bg: "intro" },
    { who: "koyomi", face: "crying", text: "限界まで「観測」したんだ......。今度は絶対に、止めるから......。" },
    { bg: "black" },
    { rewind: true },
    { who: "koyomi", face: "surprised", text: "......！" },

    { bg: "timeleap" },
    { who: "koyomi", face: "subtle_smile", text: "......成功した。過去に戻ったんだ" },
    { who: "ns", text: "{hero}は胸のあたりに手を当てる。そこには｜時空転送装置《タイムマシン》が埋め込まれている。{hero}の死をトリガーに、過去に戻るための装置だ。" },
    { who: "ns", text: "{hero}は、未詳対策特殊部隊X-02({origin})の隊員として、人類の敗北を見届ける役割を担っていた。なお、部隊については、滅びを齎した災害―ブラックスワンの顕現後に結成されたものである。" },
    { who: "koyomi", face: "serious", text: "さて、あいつの顕現までに万全の準備をしないと......" },
    { who: "koyomi", face: "surprised", text: "......え" },
    { who: "koyomi", face: "confused", text: "......まって" },
    { who: "koyomi", face: "surprised", text: "今{startDate}！？嘘でしょ。えっと......ドゥームズデイまであと{lengthDays}日！？" },
    { who: "koyomi", face: "anxious", text: "まじか......。間近じゃん......。" },
    { who: "koyomi", face: "squinting", text: "やばい、時間ない、どうしよ。戦う資金も集まるわけない......" },
    { who: "koyomi", face: "sighing", text: "......ふう" },
    { who: "koyomi", face: "fx_focused", text: "やるしかないか。FX" },

    { tab: "final" },
    { who: "koyomi", face: "serious", text: "ドゥームズデイは{deadlineMD}。それまでに資金を増やして装備を整えないと" },
    { who: "koyomi", face: "thinking", text: "ブラックスワンに対抗するための装置は、そこらにいる「残滓」を倒せば手に入る素材で作れるはず" },
    { who: "koyomi", face: "side_glance", text: "それか、財団に研究自体やめさせるのもありかも？でもな......" },
    { who: "ns", text: "ブラックスワンは、{foundation}による「{research}」が失敗した結果、顕現に至ったことがわかっている" },
    { who: "koyomi", face: "sighing", text: "突然一般人の私が行っても相手にしてくれるわけないか" },
    { who: "koyomi", face: "subtle_smile", text: "......株主にでもなれば、多少研究を妨害することくらいできるかな" },
    { who: "system", text: "ドゥームズデイまでに、位相残晶を集めて対抗装置を作り、部隊と武器のレベルを上げて、決戦に備えましょう。" },
    { who: "system", text: "また、財団の株式を購入することができれば、研究に影響を与えることができるようになり、ブラックスワンを不完全な状態で顕現させることができるかもしれません。" },
    { who: "system", text: "過半数を保有できれば、あるいは......？" },

    { tab: "town" },
    { who: "koyomi", face: "normal", text: "とりあえず、今できる準備をしようかな。まずは位相残晶を集められるように" },
    { who: "koyomi", face: "crying", text: "私1人じゃ無理だから、誰かを雇おう。......出費ぃ" },
    { who: "system", text: "町では、弾薬などの購入、仲間の雇用・訓練、探索などができます。物品の購入はもちろん、仲間の日給や訓練費にもお金がかかるので、計画的に資金を増やしていきましょう。" },
    { who: "system", text: "世界の各都市に潜んでいる「残滓」を倒して、位相残晶を集めましょう。" },
    { who: "system", text: "また、「残滓」から落ちる残留物を資金の足しにすることができます。敵によって有効な弾薬が異なるので、準備は万全にしていきましょう。" },
    { who: "system", text: "また、事前に偵察を行うことで、敵の情報を得ることができます。それだけでなく、相場の値動きの噂を耳にすることもあります（が、噂は噂なので、信じすぎないようにしましょう）。" },
    { who: "system", text: "なお、探索にはそれなりの日数を要しますが、その間はFX取引に関与できなくなるので気を付けましょう。" },

    { tab: "fx" },
    { who: "koyomi", face: "uninterested", text: "こうなることがわかってたら、相場全部覚えといたのに" },
    { who: "koyomi", face: "fx_focused", text: "なんとなく覚えてることを頼りに、リスク承知でやるしかないよね" },
    { who: "system", text: "FXは、1日の終値で取引します。相場は、実際のものですので、詳しい人は儲かるかもしれません。" },
    { who: "system", text: "外国通貨が円に対して、上がりそうなら買い（ロング）、下がりそうなら売り（ショート）を行いましょう。外国通貨は{currencyCount}種類から選べます。" },
    { who: "system", text: "取引中の状態（ポジションを持っている状態）では、実際の資金に損益は出ません（含み損益）。タイミングを見極めて「決済」し、損失を抑えて利益を目指しましょう。" },
    { who: "system", text: "なお、注文時に、損切りもしくは利確の幅を決めておけば、そこまで値動きしたときに自動で決済できます。" },
    { who: "system", text: "また、必要証拠金に対する有効証拠金（口座残高±含み損益）の割合（証拠金維持率）が{losscut}を切ると、それ以上の損失の拡大を防ぐために自動で決済されます（強制ロスカット）ので、くれぐれもお気を付けください。" },

    { tab: "map" },
    { who: "koyomi", face: "battle_normal", text: "準備ができたら「残滓」を倒しに行こう" },
    { who: "system", text: "各都市への移動にも距離に応じて日数を要します。1日ずつ進めれば、移動中はFX取引をすることができます（一気に進めることも可能）。" },
    { who: "system", text: "「残滓」は{homeCity}以外の各都市に存在します。時々、「特異な残滓」として、割のいい探索ができる場合があるので、こまめに地図を確認することをおすすめします。" },
    { who: "system", text: "{homeCity}では、円相場の噂の情報収集と、ブラックスワンを倒すための対抗装置の建造、{hero}が装着している観測レンズの強化ができます。" },
    { who: "system", text: "観測レンズを強化することで、新たな「特異な残滓」を発見できるようになるので、積極的に利用しましょう。" },
    { who: "system", text: "なお、ブラックスワンとの決戦は{homeCity}で行われます。{homeCity}までの移動の日数に注意してください（別の都市にいる場合、自動的に移動します）。" },
    { who: "koyomi", face: "battle_resolved", text: "それじゃ、始めよう" },
    { tab: "town" },
  ],

  // ── エンディング（いまは地の文だけの仮の文） ──
  // 文の中では、{deadlineDate}（ドゥームズデイの日付）・{endDate}（周回が終わった日）・{daysLeft}（ドゥームズデイまでの残り日数）・
  // {yearsAfter}（滅びまでの年数）も使える

  // エンド1：ブラックスワンを倒した
  victory: [
    { bg: "black" },
    { who: "ns", text: "{deadlineDate}。東京の空に、ブラックスワンが顕現した。" },
    { bg: "victory" },
    { who: "ns", text: "観測し、固定し、撃ち抜く。\n未来で積み重ねた敗北の記録は、{lengthDays}日の準備を経て、ひとつの結末に変わった。" },
    { who: "ns", text: "黒い羽根が舞い落ちる。地面に届く前に、そのひとつひとつが溶けるように消えていく。" },
    { who: "ns", text: "世界には、まだ爪痕が残っている。それでも、{yearsAfter}年後の滅びは、もう来ない。" },
    { who: "ns", text: "{hero}の胸の装置は、静かなままだった。" },
  ],

  // エンド2：財団の株式の過半数を握った（真エンド）
  stock: [
    { bg: "black" },
    { who: "ns", text: "{foundation}の株式の過半数が、ひとりの若い株主の手に渡った。" },
    { bg: "stock" },
    { who: "ns", text: "臨時の株主総会で、「{research}」の中止が決まった。" },
    { who: "ns", text: "研究棟の奥で、固定されかけていた「何か」は、形を結ぶことなく消えていった。" },
    { who: "ns", text: "{deadlineDate}。その日、東京の空には何も起きなかった。" },
    { who: "ns", text: "ドゥームズデイは来なかった。ブラックスワンという名前を、もう誰も知ることはない。" },
    { who: "ns", text: "誰も知らない世界の終わりを、{hero}だけが覚えている。" },
  ],

  // エンド3：決戦に敗れた
  defeat: [
    { bg: "black" },
    { who: "ns", text: "{deadlineDate}。ブラックスワンは止まらなかった。" },
    { bg: "defeat" },
    { who: "ns", text: "観測を続ける視界が、ゆっくりと赤く滲んでいく。" },
    { who: "ns", text: "胸の装置は、もう動かない。過去へ戻れるのは、一度きりだった。" },
    { who: "ns", text: "降りしきる黒い羽根の中で、{hero}は最後まで、それを見ていた。" },
  ],

  // エンド4：破産
  bankrupt: [
    { bg: "black" },
    { who: "ns", text: "{endDate}。口座の残高は、ほとんど残っていなかった。" },
    { bg: "bankrupt" },
    { who: "ns", text: "弾も、仲間への日給も、もう払えない。" },
    { who: "ns", text: "ドゥームズデイまで、あと{daysLeft}日。戦う手段を失った{hero}に、できることはもう何もなかった。" },
    { who: "ns", text: "お金は、計画的に使おう。" },
  ],
};
