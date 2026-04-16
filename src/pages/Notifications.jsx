import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { db } from '../lib/firebase';
import {
  collection, query, where, orderBy, onSnapshot,
  doc, updateDoc, writeBatch,
} from 'firebase/firestore';
import {
  Bell, CheckCircle, XCircle, Wallet, Calendar, ClipboardList,
} from 'lucide-react';

function timeAgo(date) {
  if (!date) return '';
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return 'hace un momento';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 172800) return 'ayer';
  return date.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
}

function dateGroup(date) {
  if (!date) return 'Anteriores';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today - 86400000);
  const weekAgo = new Date(today - 6 * 86400000);
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (d >= today) return 'Hoy';
  if (d >= yesterday) return 'Ayer';
  if (d >= weekAgo) return 'Esta semana';
  return 'Anteriores';
}

const TYPE_CONFIG = {
  expense_approved: { icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  expense_rejected: { icon: XCircle,     color: 'text-rose-600',    bg: 'bg-rose-50'    },
  viatico_assigned: { icon: Wallet,      color: 'text-blue-600',    bg: 'bg-blue-50'    },
  calendar_assigned:{ icon: Calendar,    color: 'text-indigo-600',  bg: 'bg-indigo-50'  },
  task_assigned:    { icon: ClipboardList, color: 'text-amber-600', bg: 'bg-amber-50'   },
};

const GROUP_ORDER = ['Hoy', 'Ayer', 'Esta semana', 'Anteriores'];

export default function Notifications() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', currentUser.uid),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(q, snap => {
      setNotifications(snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        createdAt: d.data().createdAt?.toDate() || null,
      })));
      setLoading(false);
    }, err => {
      console.error('Error fetching notifications:', err);
      setLoading(false);
    });
    return () => unsub();
  }, [currentUser]);

  const handleClick = async (notif) => {
    if (!notif.read) {
      await updateDoc(doc(db, 'notifications', notif.id), { read: true });
    }
    if (notif.link) navigate(notif.link);
  };

  const markAllRead = async () => {
    const unread = notifications.filter(n => !n.read);
    if (unread.length === 0) return;
    const batch = writeBatch(db);
    unread.forEach(n => batch.update(doc(db, 'notifications', n.id), { read: true }));
    await batch.commit();
  };

  if (loading) return <Layout title="Notificaciones">Cargando...</Layout>;

  // Group notifications
  const groups = {};
  notifications.forEach(n => {
    const g = dateGroup(n.createdAt);
    if (!groups[g]) groups[g] = [];
    groups[g].push(n);
  });

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <Layout title="Notificaciones">
      <div className="max-w-2xl mx-auto">
        {/* Header row */}
        <div className="flex justify-between items-center mb-6">
          <p className="text-sm text-slate-500">
            {unreadCount > 0
              ? <><span className="font-bold text-indigo-600">{unreadCount}</span> sin leer</>
              : 'Todo al día'}
          </p>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 underline transition-colors"
            >
              Marcar todas como leídas
            </button>
          )}
        </div>

        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400">
            <Bell className="w-16 h-16 mb-4 opacity-30" />
            <p className="text-lg font-medium">No tienes notificaciones</p>
          </div>
        ) : (
          <div className="space-y-8">
            {GROUP_ORDER.filter(g => groups[g]).map(group => (
              <div key={group}>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 px-1">{group}</p>
                <div className="space-y-2">
                  {groups[group].map(notif => {
                    const config = TYPE_CONFIG[notif.type] || TYPE_CONFIG.task_assigned;
                    const Icon = config.icon;
                    return (
                      <button
                        key={notif.id}
                        onClick={() => handleClick(notif)}
                        className={`w-full text-left flex items-start gap-4 p-4 rounded-xl border transition-all ${
                          notif.read
                            ? 'bg-white border-slate-100 hover:border-slate-200'
                            : 'bg-white border-indigo-100 shadow-sm hover:border-indigo-200'
                        }`}
                      >
                        <div className={`p-2.5 rounded-full shrink-0 ${config.bg}`}>
                          <Icon className={`w-5 h-5 ${config.color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className={`text-sm font-semibold ${notif.read ? 'text-slate-700' : 'text-slate-900'}`}>
                              {notif.title}
                            </p>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[10px] text-slate-400 whitespace-nowrap">{timeAgo(notif.createdAt)}</span>
                              {!notif.read && (
                                <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                              )}
                            </div>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{notif.message}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
