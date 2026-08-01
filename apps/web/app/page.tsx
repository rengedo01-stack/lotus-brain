import Link from "next/link";

const actions = [
  {
    href: "/upload",
    icon: "↥",
    title: "納品書を取り込む",
    description: "PDF・写真をまとめて取り込む",
    accent: "bg-[#1d4ed8] hover:bg-[#1e40af]",
  },
  {
    href: "/prices",
    icon: "¥",
    title: "価格マスター",
    description: "仕入価格と更新履歴を確認する",
    accent: "bg-[#047857] hover:bg-[#065f46]",
  },
  {
    href: "/products",
    icon: "□",
    title: "商品マスター",
    description: "商品名・単位・分類をそろえる",
    accent: "bg-[#b45309] hover:bg-[#92400e]",
  },
  {
    href: "/costs",
    icon: "％",
    title: "原価計算",
    description: "メニューごとの原価率を確認する",
    accent: "bg-[#7e22ce] hover:bg-[#6b21a8]",
  },
];

const worsenedMenus = [
  { name: "海老のチリソース", current: "39.2%", previous: "34.8%", change: "+4.4%" },
  { name: "麻婆豆腐", current: "31.5%", previous: "28.9%", change: "+2.6%" },
  { name: "五目炒飯", current: "27.8%", previous: "26.1%", change: "+1.7%" },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f7f7f5] px-4 py-6 text-slate-900 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-col gap-4 border-b border-stone-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 text-sm font-semibold tracking-[0.18em] text-[#7c2d12]">LOTUS BRAIN</p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">今日の原価状況</h1>
            <p className="mt-2 text-sm text-slate-600">原価率が上がったメニューから、確認します。</p>
          </div>
          <span className="w-fit rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-900">
            サンプルデータ表示中
          </span>
        </header>

        <section aria-label="主な操作" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {actions.map((action) => (
            <Link
              className={`${action.accent} rounded-2xl p-5 text-white shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2`}
              href={action.href}
              key={action.href}
            >
              <span className="mb-6 flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-xl font-bold">
                {action.icon}
              </span>
              <h2 className="font-bold">{action.title}</h2>
              <p className="mt-1 text-sm text-white/80">{action.description}</p>
            </Link>
          ))}
        </section>

        <section className="mt-8 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-stone-200 px-5 py-5 sm:px-7">
            <div>
              <h2 className="text-lg font-bold">原価率が悪化したメニュー</h2>
              <p className="mt-1 text-sm text-slate-500">対応の優先度が高い順です。</p>
            </div>
            <Link className="text-sm font-semibold text-[#6d28d9] hover:underline" href="/costs">
              原価計算を見る →
            </Link>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 bg-stone-50 text-left text-xs tracking-wide text-slate-500">
                <th className="px-5 py-3 font-semibold sm:px-7">メニュー</th>
                <th className="px-2 py-3 text-right font-semibold">現在</th>
                <th className="px-2 py-3 text-right font-semibold">前回</th>
                <th className="px-5 py-3 text-right font-semibold sm:px-7">差</th>
              </tr>
            </thead>
            <tbody>
              {worsenedMenus.map((menu) => (
                <tr className="border-b border-stone-100 last:border-0" key={menu.name}>
                  <td className="px-5 py-4 font-medium sm:px-7">{menu.name}</td>
                  <td className="px-2 py-4 text-right font-semibold">{menu.current}</td>
                  <td className="px-2 py-4 text-right text-slate-500">{menu.previous}</td>
                  <td className="px-5 py-4 text-right font-semibold text-red-700 sm:px-7">▲{menu.change}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
