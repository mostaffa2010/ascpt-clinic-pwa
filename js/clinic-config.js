// ========================================================
// Alexandria Specialized Center for Physical Therapy (ASCPT)
// Central Clinic Configuration & Production Supabase Engine
// Version: 1.4.96
// ========================================================

export const CLINIC_CONFIG = {
  id: 'ascpt-clinic-pwa',
  brandName: 'مركز الإسكندرية التخصصي للعلاج الطبيعي',
  shortName: 'مركز الإسكندرية التخصصي',
  englishName: 'Alexandria Specialized Center for Physical Therapy',
  abbreviation: 'ASCPT',
  tagline: 'نظام إدارة مراكز وعيادات العلاج الطبيعي',
  version: '1.4.96',
  director: {
    name: 'د. حسني أحمد الجويلي',
    title: 'إستشاري العلاج الطبيعي والتقويم الحركي للعمود الفقري'
  },
  contact: {
    address: '١٧ شارع حسين شيرين - لوران - الإسكندرية',
    phone: '03-5702356',
    email: 'algewelyspinecare@yahoo.com'
  },
  settings: {
    defaultCurrency: 'ج.م',
    allowDoctorDeletePatient: false,
    enableInsuranceClaims: true,
    enableAttendanceCards: true
  },
  supabase: {
    url: 'https://wpgjkqlswiszwfyqlujz.supabase.co',
    anonKey: 'sb_publishable_uMXZizxCE1H5xyMS8Fwcww_3sES_YaR'
  }
};

const SUPABASE_URL = CLINIC_CONFIG.supabase.url;
const SUPABASE_KEY = CLINIC_CONFIG.supabase.anonKey;
export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

const AUTH_STORAGE_KEY = 'ascpt_supabase_session';

function getStoredSession() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function setStoredSession(session) {
  try {
    if (session) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  } catch (_) {}
}

const authListeners = new Set();

export class NativeSupabaseClient {
  constructor() {
    this.url = SUPABASE_URL;
    this.key = SUPABASE_KEY;

    this.auth = {
      getSession: async () => {
        const session = getStoredSession();
        return { data: { session }, error: null };
      },

      onAuthStateChange: (callback) => {
        authListeners.add(callback);
        const currentSession = getStoredSession();
        if (currentSession) {
          setTimeout(() => callback('INITIAL_SESSION', currentSession), 10);
        }
        return {
          data: {
            subscription: {
              unsubscribe: () => authListeners.delete(callback)
            }
          }
        };
      },

      signInWithPassword: async ({ email, password }) => {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ email: (email || '').trim(), password })
        });

        const data = await res.json();
        if (!res.ok) {
          const errMsg = data.error_description || data.msg || data.message || 'بيانات الدخول غير صحيحة';
          return { data: null, error: new Error(errMsg) };
        }

        const session = {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: data.expires_at,
          user: data.user
        };
        setStoredSession(session);
        authListeners.forEach(cb => cb('SIGNED_IN', session));

        return { data: { user: data.user, session }, error: null };
      },

      signUp: async ({ email, password, options = {} }) => {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: (email || '').trim(),
            password,
            data: options.data || {}
          })
        });

        const data = await res.json();
        if (!res.ok) {
          const errMsg = data.error_description || data.msg || data.message || 'فشل إنشاء الحساب';
          return { data: null, error: new Error(errMsg) };
        }
        return { data, error: null };
      },

      signOut: async () => {
        const session = getStoredSession();
        setStoredSession(null);
        authListeners.forEach(cb => cb('SIGNED_OUT', null));

        if (session?.access_token) {
          try {
            await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
              method: 'POST',
              headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${session.access_token}`
              }
            });
          } catch (_) {}
        }
        return { error: null };
      },

      resetPasswordForEmail: async (email) => {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ email: (email || '').trim() })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return { error: new Error(err.message || 'تعذر إرسال رابط الاستعادة.') };
        }
        return { error: null };
      },

      updateUser: async ({ password }) => {
        const session = getStoredSession();
        if (!session?.access_token) return { error: new Error('غير مسجل') };

        const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          method: 'PUT',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ password })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return { error: new Error(err.message || 'تعذر تحديث كلمة المرور.') };
        }
        return { error: null };
      }
    };
  }

  from(table) {
    const session = getStoredSession();
    const token = session?.access_token || SUPABASE_KEY;

    let method = 'GET';
    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
    const params = new URLSearchParams();
    let bodyPayload = null;
    let isSingle = false;

    const builder = {
      select(columns = '*') {
        params.set('select', columns);
        return builder;
      },
      eq(column, value) {
        params.set(column, `eq.${value}`);
        return builder;
      },
      lt(column, value) {
        params.set(column, `lt.${value}`);
        return builder;
      },
      like(column, pattern) {
        params.set(column, `like.${pattern}`);
        return builder;
      },
      order(column, { ascending = true } = {}) {
        params.set('order', `${column}.${ascending ? 'asc' : 'desc'}`);
        return builder;
      },
      limit(n) {
        params.set('limit', String(n));
        return builder;
      },
      single() {
        isSingle = true;
        headers['Accept'] = 'application/vnd.pgrst.object+json';
        return builder;
      },
      maybeSingle() {
        isSingle = true;
        return builder;
      },
      insert(rows) {
        method = 'POST';
        headers['Prefer'] = 'return=representation';
        bodyPayload = JSON.stringify(rows);
        return builder;
      },
      upsert(rows) {
        method = 'POST';
        headers['Prefer'] = 'resolution=merge-duplicates,return=representation';
        bodyPayload = JSON.stringify(rows);
        return builder;
      },
      update(fields) {
        method = 'PATCH';
        headers['Prefer'] = 'return=representation';
        bodyPayload = JSON.stringify(fields);
        return builder;
      },
      delete() {
        method = 'DELETE';
        return builder;
      },
      then(resolve, reject) {
        const qs = params.toString();
        const endpoint = qs ? `${SUPABASE_URL}/rest/v1/${table}?${qs}` : `${SUPABASE_URL}/rest/v1/${table}`;

        return fetch(endpoint, {
          method,
          headers,
          body: bodyPayload
        })
          .then(async (res) => {
            if (!res.ok) {
              const errText = await res.text();
              let parsedErr;
              try { parsedErr = JSON.parse(errText); } catch (_) { parsedErr = { message: errText }; }
              return { data: null, error: parsedErr };
            }

            if (method === 'DELETE' || res.status === 204) {
              return { data: null, error: null };
            }

            const json = await res.json();
            if (isSingle && Array.isArray(json)) {
              return { data: json[0] || null, error: null };
            }
            return { data: json, error: null };
          })
          .catch((err) => {
            return { data: null, error: err };
          })
          .then(resolve, reject);
      }
    };

    return builder;
  }
}

export const supabase = new NativeSupabaseClient();
if (typeof window !== 'undefined') {
  window.supabase = supabase;
}
