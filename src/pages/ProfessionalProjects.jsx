import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import EmptyState from '../components/EmptyState';
import { db } from '../lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { useAuth } from '../context/useAuth';
import { FolderOpen, Phone, Mail, User, Car, Wrench } from 'lucide-react';
import { sortProjects } from '../utils/sort';

// NOTE: Firestore requires a composite index for this query:
//   Collection: projects
//   Fields: recursos.ingenieros (Arrays) + status (Ascending)
// If you query only by recursos.ingenieros (array-contains), no index is needed.

const STATUS_LABELS = {
  active:      { label: 'Activo',      cls: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  completed:   { label: 'Completado',  cls: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
  paused:      { label: 'Pausado',     cls: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  cancelled:   { label: 'Cancelado',   cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
};

function StatusBadge({ status }) {
  const cfg = STATUS_LABELS[status] || { label: status || 'N/A', cls: 'bg-slate-500/20 text-slate-400 border-slate-500/30' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

export default function ProfessionalProjects() {
  const { currentUser } = useAuth();
  const [projects, setProjects] = useState([]);
  const [reportStatusMap, setReportStatusMap] = useState({});
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    const fetchProjects = async () => {
      try {
        // NOTE: This array-contains query on a nested field requires a Firestore single-field index
        // on `recursos.ingenieros`. Go to Firebase Console > Firestore > Indexes to create it if needed.
        const snap = await getDocs(
          query(
            collection(db, 'projects'),
            where('recursos.ingenieros', 'array-contains', currentUser.uid)
          )
        );
        setProjects(sortProjects(snap.docs.map(d => ({ id: d.id, ...d.data() }))));

        // Secondary fetch: reports status
        const reportsSnap = await getDocs(
          query(collection(db, 'reports'), 
            where('authorId', '==', currentUser.uid),
            where('status', 'in', ['submitted', 'in_progress'])
          )
        );
        const reportMap = {};
        reportsSnap.docs.forEach(d => {
          reportMap[d.data().projectId] = d.data().status;
        });
        setReportStatusMap(reportMap);

      } catch (e) {
        console.error('Error al cargar proyectos:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchProjects();
  }, [currentUser]);

  return (
    <Layout title="Mis Proyectos">
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-slate-800 border border-slate-700 rounded-2xl p-5 animate-pulse">
              <div className="h-4 bg-slate-700 rounded w-1/3 mb-3" />
              <div className="h-6 bg-slate-700 rounded w-2/3 mb-5" />
              <div className="h-3 bg-slate-700 rounded w-full mb-2" />
              <div className="h-3 bg-slate-700 rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="Sin proyectos asignados"
          description="Aún no tienes proyectos activos asociados a tu cuenta."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {projects.map(project => (
            <ProjectCard key={project.id} project={project} reportStatusMap={reportStatusMap} />
          ))}
        </div>
      )}
    </Layout>
  );
}

function ProjectCard({ project, reportStatusMap }) {
  const { code, name, client, status, contacto, recursos } = project;
  const phone   = contacto?.telefono;
  const email   = contacto?.email;
  const contact = contacto?.nombre;
  const cargo   = contacto?.cargo;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {code && (
            <p className="text-indigo-400 font-mono text-xs font-bold mb-0.5">[{code}]</p>
          )}
          <h3 className="text-white font-bold text-base leading-snug">{name}</h3>
          <div className="flex items-center gap-2 mt-1">
            {client && (
              <p className="text-slate-400 text-xs truncate">{client}</p>
            )}
            {reportStatusMap?.[project.id] && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                {reportStatusMap[project.id] === 'submitted' ? 'Informe enviado' : 'En confección'}
              </span>
            )}
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Contact info */}
      {(contact || phone || email) && (
        <div className="border-t border-slate-700 pt-3 space-y-2">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Contacto</p>
          {contact && (
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <User className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span>{contact}{cargo ? ` · ${cargo}` : ''}</span>
            </div>
          )}
          {phone && (
            <div className="flex items-center gap-2 text-sm">
              <Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <a
                href={`https://wa.me/${phone.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                {phone}
              </a>
            </div>
          )}
          {email && (
            <div className="flex items-center gap-2 text-sm">
              <Mail className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <a
                href={`mailto:${email}`}
                className="text-indigo-400 hover:text-indigo-300 transition-colors truncate"
              >
                {email}
              </a>
            </div>
          )}
        </div>
      )}

      {/* Resources */}
      {(recursos?.vehiculo || recursos?.equipamiento) && (
        <div className="border-t border-slate-700 pt-3 space-y-2">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Recursos</p>
          {recursos.vehiculo && (
            <div className="flex items-start gap-2 text-sm text-slate-300">
              <Car className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
              <span>{recursos.vehiculo}</span>
            </div>
          )}
          {recursos.equipamiento && (
            <div className="flex items-start gap-2 text-sm text-slate-300">
              <Wrench className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
              <span>{recursos.equipamiento}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
