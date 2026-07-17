export default function UploadPage() {
  return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white p-10 rounded-2xl shadow-xl w-[600px]">

        <h1 className="text-3xl font-bold mb-8">
          📥 納品書取込
        </h1>

        <div className="border-2 border-dashed rounded-xl p-10 text-center">

          <p className="text-gray-500 mb-6">
            PDF・写真を選択してください
          </p>

          <input
            type="file"
            accept=".pdf,image/*"
            className="mb-6"
          />

          <br />

          <button className="bg-blue-600 text-white px-8 py-3 rounded-xl hover:bg-blue-700">
            取り込む
          </button>

        </div>

      </div>
    </main>
  );
}