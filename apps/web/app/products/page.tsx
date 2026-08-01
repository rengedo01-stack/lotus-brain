import Link from "next/link";

const products = [
  { name: "海老むき", category: "魚介", unit: "kg", code: "FOOD-000001" },
  { name: "長葱", category: "野菜", unit: "kg", code: "FOOD-000002" },
  { name: "ケチャップ", category: "調味料", unit: "kg", code: "FOOD-000003" },
  { name: "豆板醤", category: "調味料", unit: "kg", code: "FOOD-000004" },
];

export default function ProductsPage() {
  return (
    <main className="min-h-screen bg-[#f7f7f5] px-4 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <Link className="text-sm font-semibold text-[#b45309] hover:underline" href="/">
          ← 今日の原価状況へ戻る
        </Link>
        <header className="mt-6 border-b border-stone-200 pb-6">
          <p className="text-sm font-semibold tracking-[0.16em] text-[#b45309]">商品マスター</p>
          <h1 className="mt-2 text-3xl font-bold">食材の基準をそろえる</h1>
          <p className="mt-2 text-sm text-slate-600">表記ゆれをまとめ、原価計算に使う単位を決めます。</p>
        </header>
        <section className="mt-7 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold sm:px-7">Lotus標準名称</th>
                <th className="px-2 py-3 font-semibold">分類</th>
                <th className="px-2 py-3 text-right font-semibold">基準単位</th>
                <th className="hidden px-5 py-3 text-right font-semibold sm:table-cell">商品ID</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr className="border-t border-stone-100" key={product.code}>
                  <td className="px-5 py-4 font-medium sm:px-7">{product.name}</td>
                  <td className="px-2 py-4 text-slate-600">{product.category}</td>
                  <td className="px-2 py-4 text-right text-slate-600">{product.unit}</td>
                  <td className="hidden px-5 py-4 text-right font-mono text-xs text-slate-500 sm:table-cell">{product.code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
