// ========================================================
// ASCPT - System Health & Supabase Bridge Endpoint
// Alexandria Specialized Center for Physical Therapy
// ========================================================

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res.status(200).json({
    status: 'online',
    system: 'ASCPT Clinic Management System',
    database: 'supabase',
    timestamp: new Date().toISOString()
  });
}
