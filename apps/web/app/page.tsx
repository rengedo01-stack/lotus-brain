export default function Home() {
  return (
    <main className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-5xl mx-auto">

        <h1 className="text-4xl font-bold mb-8">
          Lotus BRAIN
        </h1>

        <div className="grid grid-cols-2 gap-6">

          <button className="bg-blue-600 text-white rounded-xl p-8 text-2xl hover:bg-blue-700">
            📥 納品書を取り込む
          </button>

          <button className="bg-green-600 text-white rounded-xl p-8 text-2xl hover:bg-green-700">
            💰 価格マスター
          </button>

          <button className="bg-orange-500 text-white rounded-xl p-8 text-2xl hover:bg-orange-600">
            📦 商品マスター
          </button>

          <button className="bg-purple-600 text-white rounded-xl p-8 text-2xl hover:bg-purple-700">
            📊 原価計算
          </button>

        </div>

        <div className="bg-white rounded-xl shadow mt-10 p-6">
          <h2 className="text-2xl font-bold mb-4">
            原価率が悪化したメニュー
          </h2>

          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2">メニュー</th>
                <th>現在</th>
                <th>前回</th>
                <th>差</th>
              </tr>
            </thead>

            <tbody>
              <tr className="border-b">
                <td className="py-3">海老チリ</td>
                <td>39.2%</td>
                <td>34.8%</td>
                <td className="text-red-600">▲4.4%</td>
              </tr>

              <tr className="border-b">
                <td className="py-3">麻婆豆腐</td>
                <td>31.5%</td>
                <td>28.9%</td>
                <td className="text-red-600">▲2.6%</td>
              </tr>

            </tbody>
          </table>

        </div>

      </div>
    </main>
  );
}