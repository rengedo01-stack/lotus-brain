import Link from "next/link";

const ingredients = [
  { name: "海老むき", amount: "0.180 kg", unitPrice: "2,980円/kg", cost: "536円" },
  { name: "長葱", amount: "0.050 kg", unitPrice: "680円/kg", cost: "34円" },
  { name: "ケチャップ", amount: "0.060 kg", unitPrice: "460円/kg", cost: "28円" },
  { name: "豆板醤", amount: "0.020 kg", unitPrice: "1,200円/kg", cost: "24円" },
  { name: "片栗粉", amount: "0.030 kg", unitPrice: "400円/kg", cost: "12円" },
];

export default function CostsPage() {
  return (
    <main className="min-h-screen bg-[#f7f7f5] px-4 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <Link className="text-sm font-semibold text-[#6d28d9] hover:underline" href="/">
          ← 今日の原価状況へ戻る
        </Link>
        <header className="mt-6 flex flex-col gap-4 border-b border-stone-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold tracking-[0.16em] text-[#6d28d9]">原価計算</p>
            <h1 className="mt-2 text-3xl font-bold">海老のチリソース</h1>
            <p className="mt-2 text-sm text-slate-600">販売価格 1,980円（税込）・サンプルデータ</p>
          </div>
          <div className="rounded-xl bg-red-50 px-4 py-3 text-right">
            <p className="text-xs font-semibold text-red-800">現在の原価率</p>
            <p className="text-2xl font-bold text-red-800">39.2%</p>
          </div>
        </header>

        <section className="mt-7 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="border-b border-stone-200 px-5 py-5 sm:px-7">
            <h2 className="font-bold">一皿あたりの食材原価</h2>
            <p className="mt-1 text-sm text-slate-500">単価は価格マスターをもとに自動更新される想定です。</p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold sm:px-7">食材</th>
                <th className="px-2 py-3 text-right font-semibold">使用量</th>
                <th className="px-2 py-3 text-right font-semibold">最新単価</th>
                <th className="px-5 py-3 text-right font-semibold sm:px-7">使用原価</th>
              </tr>
            </thead>
            <tbody>
              {ingredients.map((ingredient) => (
                <tr className="border-t border-stone-100" key={ingredient.name}>
                  <td className="px-5 py-4 font-medium sm:px-7">{ingredient.name}</td>
                  <td className="px-2 py-4 text-right text-slate-600">{ingredient.amount}</td>
                  <td className="px-2 py-4 text-right text-slate-600">{ingredient.unitPrice}</td>
                  <td className="px-5 py-4 text-right font-semibold sm:px-7">{ingredient.cost}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-stone-200 bg-stone-50">
              <tr>
                <td className="px-5 py-4 font-bold sm:px-7" colSpan={3}>食材原価 合計</td>
                <td className="px-5 py-4 text-right text-lg font-bold sm:px-7">634円</td>
              </tr>
            </tfoot>
          </table>
        </section>

        <p className="mt-5 text-sm text-slate-500">
          次の段階で、実際のレシピ表・価格マスターを取り込み、この画面を本物の数字に置き換えます。
        </p>
      </div>
    </main>
  );
}
