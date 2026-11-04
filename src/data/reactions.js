// こよみの反応（操作のあとに、画面の下に一言だけ出る台詞）
//
// キーごとに台詞の候補を並べる。出すたびに、候補の中からランダムに1つ選ぶ（直前と同じものは避ける）。
// 台詞は [文, 表情] の組。表情は assets/portraits/koyomi/<表情>.webp
// どの場面でどのキーを使うかは src/ui/app.js の reactFx などを参照。

export const REACTIONS = {
  // ── 探索に勝ったとき（出撃中のFXの様子で選ぶ）・日数を飛ばしたとき（ポジションがあれば） ──
  unrealizedLoss: [
    ["まあこの程度、ね", "side_glance"],
    ["......見なかったことにしよ", "uninterested"],
    ["戻るでしょ、戻るよね、戻れ", "anxious"],
  ],
  stopLoss: [
    ["死ななきゃいいよ、死ななきゃ", "sighing"],
    ["......必要経費、必要経費", "uninterested"],
  ],
  losscut: [
    ["なんでこんなことに......", "fx_big_loss"],
    ["く、苦しい", "crying"],
    ["なんでなんでなんで", "fx_big_loss"],
    ["ありえない", "surprised"],
    ["強制は聞いてないよ......", "crying"],
  ],
  unrealizedGain: [
    ["含み損がないって、サイコ～", "fx_big_win"],
    ["このまま伸びてね", "fx_focused"],
    ["先見の明、だね", "subtle_smile"],
  ],
  takeProfit: [
    ["え、余裕か", "fx_profit_secured"],
    ["敗北を知りたいね", "fx_big_win"],
  ],
  noPosition: [
    ["いい運動になったね", "subtle_smile"],
    ["いいじゃん", "normal"],
    ["ノーポジは平和だね", "subtle_smile"],
  ],

  // ── 探索に負けたとき（撤退・全滅） ──
  defeat: [
    ["力不足か......", "battle_damaged"],
    ["厳しい......", "sighing"],
  ],

  // ── 偵察 ──
  scout: [
    ["なるほどね", "thinking"],
    ["情報は多い方がいい", "serious"],
  ],

  // ── FX口座 ──
  buy: [
    ["ロング、発射", "fx_focused"],
    ["お願い......上がってね", "anxious"],
    ["上だよね、信じるよ", "fx_focused"],
    ["上がれ～", "fx_focused"],
  ],
  sell: [
    ["ショート、発射", "fx_focused"],
    ["下がるよね、ね", "anxious"],
    ["下だよね、頼むよ", "fx_focused"],
    ["落ちろ、落ちたな", "fx_focused"],
  ],
  closeWin: [
    ["いい調子", "fx_profit_secured"],
    ["もしかして才能ある？", "fx_big_win"],
    ["これでまた戦える", "subtle_smile"],
    ["よし、利確", "fx_profit_secured"],
    ["勝ち逃げ一択だね", "fx_big_win"],
  ],
  closeLoss: [
    ["まあ、多少はね", "side_glance"],
    ["織り込み済みだよ、このくらい", "uninterested"],
    ["死ぬわけじゃないから", "sighing"],
    ["損切り、次", "serious"],
    ["大丈夫、まだ致命傷じゃない", "anxious"],
    ["......取り返せばいいし", "uninterested"],
  ],

  // ── 仲間を雇ったとき ──
  hire: [
    ["よろしくね", "subtle_smile"],
    ["一緒に世界を救おう", "battle_resolved"],
  ],

  // ── 東京・決戦 ──
  build: [
    ["また、一歩進んだ", "battle_resolved"],
    ["絶対に負けないから", "serious"],
  ],
  final: [["それじゃ、終わらせよう", "battle_resolved"]],
};
