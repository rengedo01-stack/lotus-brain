import Link from "next/link";

const prices = [
  { name: "海老むき", supplier: "相川商店", unit: "kg", price: "2,980円", updated: "2026/07/29" },
  { name: "長葱", supplier: "相川商店", unit: "kg", price: "680円", updated: "2026/07/29" },
  { name: "ケチャップ", supplier: "業務用スーパー", unit: "kg", price: "460円", updated: "2026/07/28" },
  { name: "豆板醤", supplier: "相川商店", unit: "kg", price: "1,200円", updated: "2026/07/29" },
];

export default function PricesPage() {
  return (
    <main className="min-h-screen bg-[#f7f7f5] px-4 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <Link className="text-sm font-semibold text-[#047857] hover:underline" href="/">
          ← 今日の原価状況へ戻る
        </Link>
        <header className="mt-6 border-b border-stone-200 pb-6">
          <p className="text-sm font-semibold tracking-[0.16em] text-[#047857]">価格マスター</p>
          <h1 className="mt-2 text-3xl font-bold">最新の仕入価格</h1>
          <p className="mt-2 text-sm text-slate-600">納品書・レシートを確認した後、この一覧が更新されます。</p>
        </header>
        <section className="mt-7 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold sm:px-7">商品</th>
                <th className="hidden px-2 py-3 font-semibold sm:table-cell">仕入先</th>
                <th className="px-2 py-3 text-right font-semibold">最新単価</th>
                <th className="px-5 py-3 text-right font-semibold sm:px-7">更新日</th>
              </tr>
            </thead>
            <tbody>
              {prices.map((item) => (
                <tr className="border-t border-stone-100" key={item.name}>
                  <td className="px-5 py-4 font-medium sm:px-7">{item.name}<span className="ml-2 text-xs font-normal text-slate-500">/{item.unit}</span></td>
                  <td className="hidden px-2 py-4 text-slate-600 sm:table-cell">{item.supplier}</td>
                  <td className="px-2 py-4 text-right font-semibold">{item.price}</td>
                  <td className="px-5 py-4 text-right text-slate-600 sm:px-7">{item.updated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
