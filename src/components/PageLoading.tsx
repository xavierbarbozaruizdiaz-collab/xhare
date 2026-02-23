export default function PageLoading() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <p className="text-gray-600 mb-6">Cargando...</p>
      <div className="space-y-4 max-w-2xl">
        <div className="h-4 bg-gray-200 rounded animate-pulse" />
        <div className="h-4 bg-gray-200 rounded animate-pulse w-5/6" />
        <div className="h-4 bg-gray-200 rounded animate-pulse w-4/6" />
        <div className="h-32 bg-gray-200 rounded animate-pulse mt-6" />
        <div className="h-4 bg-gray-200 rounded animate-pulse w-3/6" />
        <div className="h-4 bg-gray-200 rounded animate-pulse w-5/6" />
      </div>
    </div>
  );
}
