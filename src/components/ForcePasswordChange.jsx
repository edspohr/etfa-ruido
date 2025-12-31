import { useState } from 'react';
import { updatePassword } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Lock } from 'lucide-react';

export default function ForcePasswordChange({ user }) {
    const [newPass, setNewPass] = useState('');
    const [confirmPass, setConfirmPass] = useState('');
    const [loading, setLoading] = useState(false);

    const match = newPass === confirmPass;
    const valid = newPass.length >= 6;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!match || !valid) return;
        setLoading(true);

        try {
            // 1. Update Password in Auth
            await updatePassword(user, newPass);

            // 2. Remove flag in Firestore
            await updateDoc(doc(db, "users", user.uid), {
                forcePasswordChange: false
            });

            alert("Contraseña actualizada exitosamente.");
            window.location.reload(); // Refresh to clear state
        } catch (error) {
            console.error(error);
            alert("Error al actualizar: " + error.message);
            // If error is "Recent Login Required", we might need to re-auth, 
            // but since they JUST logged in, it should be fine.
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-8">
                <div className="flex items-center text-orange-600 mb-4">
                    <Lock className="w-8 h-8 mr-2" />
                    <h2 className="text-2xl font-bold">Cambio de Contraseña Obligatorio</h2>
                </div>
                <p className="text-gray-600 mb-6">
                    Por seguridad, debes establecer una nueva contraseña personal antes de continuar.
                </p>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Nueva Contraseña</label>
                        <input 
                            type="password" 
                            value={newPass}
                            onChange={(e) => setNewPass(e.target.value)}
                            className="mt-1 w-full p-3 border rounded focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="Mínimo 6 caracteres"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Confirmar Contraseña</label>
                        <input 
                            type="password" 
                            value={confirmPass}
                            onChange={(e) => setConfirmPass(e.target.value)}
                            className={`mt-1 w-full p-3 border rounded focus:ring-2 outline-none ${!match && confirmPass ? 'border-red-500' : ''}`}
                            placeholder="Repite la contraseña"
                            required
                        />
                        {!match && confirmPass && <p className="text-xs text-red-500 mt-1">Las contraseñas no coinciden</p>}
                    </div>

                    <button 
                        type="submit" 
                        disabled={!match || !valid || loading}
                        className="w-full bg-blue-600 text-white py-3 rounded font-bold hover:bg-blue-700 disabled:opacity-50 transition"
                    >
                        {loading ? 'Actualizando...' : 'Cambiar Contraseña y Entrar'}
                    </button>
                    {!valid && newPass && <p className="text-xs text-center text-gray-400">La contraseña debe tener al menos 6 caracteres.</p>}
                </form>
            </div>
        </div>
    );
}
