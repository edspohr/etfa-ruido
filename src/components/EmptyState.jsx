export default function EmptyState({ icon: Icon, title, description }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      {Icon && <Icon className="w-12 h-12 text-slate-400 mb-4" />}
      <p className="text-slate-600 font-medium text-base mb-1">{title}</p>
      {description && (
        <p className="text-slate-400 text-sm max-w-xs">{description}</p>
      )}
    </div>
  );
}
