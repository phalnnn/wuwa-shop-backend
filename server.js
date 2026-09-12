const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// Kết nối trực tiếp cơ sở dữ liệu Supabase bằng Service Role Key
const SUPABASE_URL = 'https://okfuncwyrjgeqddunzal.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rZnVuY3d5cmpnZXFkZHVuemFsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTIwODgyMiwiZXhwIjoyMTA0Nzg0ODIyfQ.AvqyMo-e2qDuXJmlA5RPVoUFTlKuexs0M55vvRftQwI';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Endpoint kiểm tra máy chủ hoạt động
app.get('/', (req, res) => {
  res.send('Shop Wuthering Waves Backend is Running!');
});

// 1. API: Lấy danh sách tài khoản chưa bán
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

// 2. API: Khách bấm mua -> Tạo đơn hàng mới
app.post('/api/create-order', async (req, res) => {
  const { accountId, customerEmail } = req.body;
  if (!accountId || !customerEmail) {
    return res.status(400).json({ error: 'Thiếu thông tin mua hàng!' });
  }

  // Kiểm tra tài khoản còn trạng thái 'available' không
  const { data: acc, error: accErr } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', accountId)
    .eq('status', 'available')
    .single();

  if (accErr || !acc) {
    return res.status(400).json({ error: 'Tài khoản này đã có người mua hoặc không tồn tại!' });
  }

  // Tạo mã đơn hàng dạng DH + 4 số ngẫu nhiên (Ví dụ: DH4821)
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

// 3. API: Web thăm dò (polling) kiểm tra trạng thái đơn
app.get('/api/order-status/:orderCode', async (req, res) => {
  const { orderCode } = req.params;
  const { data: order } = await supabase
    .from('orders')
    .select('status, account_id, accounts(account_info)')
    .eq('order_code', orderCode)
    .single();

  if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

  if (order.status === 'completed') {
    return res.json({
      status: 'completed',
      accountInfo: order.accounts ? order.accounts.account_info : null
    });
  }

  res.json({ status: 'pending' });
});

// 4. API: Nhận Webhook từ SePay khi có biến động số dư chuyển khoản
app.post('/api/webhook/sepay', async (req, res) => {
  const { content, transferAmount } = req.body;
  console.log(`[Webhook SePay] Số tiền: ${transferAmount}đ | Nội dung: "${content}"`);

  // Tìm mã đơn DHxxxx trong nội dung chuyển khoản
  const match = content && content.match(/DH\d+/i);
  if (!match) {
    return res.json({ success: true, message: 'Nội dung không chứa mã đơn hàng' });
  }
  const orderCode = match[0].toUpperCase();

  // Tìm đơn hàng trong Database
  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('order_code', orderCode)
    .single();

  // Xác thực đơn đang chờ và số tiền chuyển đủ
  if (order && order.status === 'pending' && transferAmount >= order.amount) {
    // 1. Khóa acc chuyển thành 'sold'
    await supabase
      .from('accounts')
      .update({ status: 'sold' })
      .eq('id', order.account_id);

    // 2. Chuyển trạng thái đơn sang 'completed' để frontend nhả acc ra màn hình
    await supabase
      .from('orders')
      .update({ status: 'completed' })
      .eq('id', order.id);

    console.log(`[Hoàn thành] Giao dịch mã ${orderCode} thành công!`);
  }

  res.json({ success: true });
});

// Cổng lắng nghe máy chủ Cloud của Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
