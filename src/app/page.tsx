export default function HomePage() {
  return (
    <main className="min-h-screen p-4 max-w-lg mx-auto flex flex-col justify-center items-center text-center">
      <div className="bg-surface border border-line rounded-ticket p-6 w-full shadow-sm">
        <div className="flex items-center justify-between border-b border-line pb-3 mb-4">
          <span className="font-heading text-3xl font-semibold text-ink num">#A-001</span>
          <span className="text-xs bg-line text-slate px-2.5 py-1 rounded-full font-medium">NEW</span>
        </div>
        <h1 className="text-2xl font-semibold text-ink mb-2">Order Desk</h1>
        <p className="text-slate text-sm mb-6">
          Order management web app (PWA) for restaurants, cafes, delivery and repair shops.
        </p>
        <button
          type="button"
          className="w-full h-12 bg-ember text-on-ember rounded-control font-semibold text-base transition-opacity active:opacity-90"
        >
          Open Board
        </button>
      </div>
    </main>
  );
}
