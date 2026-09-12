const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// Gắn trực tiếp URL và Key Supabase
const SUPABASE_URL = 'https://okfuncwyrjgeqddunzal.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rZnVuY3d5cmpnZXFkZHVuemFsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTIwODgyMiwiZXhwIjoyMTA0Nzg0ODIyfQ.AvqyMo-e2qDuXJmlA5RPVoUFTlKuexs0M55vvRftQwI';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 1. API kiểm tra server hoạt động
app.get('/', (req, res) => {
  res.send('Shop Wuthering Waves Backend is Running!');
});

// 2. API lấy danh sách acc còn hàng
app.get('/api/accounts', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('accounts')
      .select('id, game_name, price, status')
      .eq('status', 'available');

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. API tạo đơn hàng
app.post('/api/create-order', async (req, res) => {
  const { accountId, customerEmail } = req.body;
  if (!accountId || !customerEmail) return res.status(400).json({ error: 'Thiếu thông tin' });

  const { data: acc, error: accErr } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', accountId)
    .eq('status', 'available')
    .single();

  if (accErr || !acc) return res.status(400).json({ error: 'Tài khoản không còn trống' });

  const orderCode = 'DH' + Math.floor(1000 + Math.random() * 9000);

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert([{
      order_code: orderCode,
      account_id: acc.id,
      amount: acc.price,
      customer_email: customerEmail,
      status: 'pending'
    }])
    .select()
    .single();

  if (orderErr) return res.status(500).json({ error: orderErr.message });

  res.json({
    orderCode: order.order_code,
    amount: order.amount,
    gameName: acc.game_name
  });
});

// 4. API kiểm tra trạng thái đơn
app.get('/api/order-status/:orderCode', async (req, res) => {
  const { orderCode } = req.params;
  const { data: order } = await supabase
    .from('orders')
    .select('status, account_id, accounts(account_info)')
    .eq('order_code', orderCode)
    .single();

  if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn' });

  if (order.status === 'completed') {
    return res.json({
      status: 'completed',
      accountInfo: order.accounts ? order.accounts.account_info : null
    });
  }

  res.json({ status: 'pending' });
});

// 5. Cấu hình cổng chạy chuẩn theo môi trường Cloud của Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend listening on port ${PORT}`);
});
