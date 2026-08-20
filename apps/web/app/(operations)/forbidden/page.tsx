import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <section aria-labelledby="forbidden-title" className="mx-auto max-w-xl rounded-xl bg-white p-6 shadow-sm">
      <p className="text-sm font-medium text-amber-700">アクセスが許可されていません</p>
      <h1 className="mt-2 text-2xl font-bold text-slate-950" id="forbidden-title">この操作を行う権限がありません</h1>
      <p className="mt-3 text-sm text-slate-700">必要な権限については、管理者にお問い合わせください。</p>
      <Link className="mt-6 inline-flex rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/">
        ホームへ戻る
      </Link>
    </section>
  );
}
