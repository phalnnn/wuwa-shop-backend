const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Kết nối Supabase thông qua biến môi trường
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 1. Lấy danh sách acc có sẵn (bản nguyên gốc cũ)
app.get('/api/accounts', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('accounts')
    .select('id, game_name, price, status, image_url')
      .eq('status', 'available');

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Tạo đơn hàng mới
app.post('/api/create-order', async (req, res) => {
  const { accountId, customerEmail } = req.body;

  try {
    const { data: acc, error: accErr } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', accountId)
      .eq('status', 'available')
      .single();

    if (accErr || !acc) {
      return res.status(400).json({ error: 'Tài khoản này không tồn tại hoặc đã bán!' });
    }

    const orderCode = 'DH' + Math.floor(10000 + Math.random() * 90000);

    const { data: newOrder, error: orderErr } = await supabase
      .from('orders')
      .insert([
        {
          order_code: orderCode,
          account_id: acc.id,
          game_name: acc.game_name,
          account_info: acc.account_info,
          amount: acc.price,
          customer_email: customerEmail || 'guest@shop.local',
          status: 'pending'
        }
      ])
      .select()
      .single();

    if (orderErr) throw orderErr;

    res.json({
      success: true,
      orderCode: newOrder.order_code,
      amount: newOrder.amount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Webhook SePay
app.post('/api/webhook/sepay', async (req, res) => {
  const { content, transferAmount } = req.body;
  const match = content && content.match(/DH\d+/i);
  if (!match) {
    return res.json({ success: true, message: 'Không tìm thấy mã đơn' });
  }
  const orderCode = match[0].toUpperCase();

  try {
    const { data: order, error: findErr } = await supabase
      .from('orders')
      .select('*')
      .eq('order_code', orderCode)
      .single();

    if (order && order.status === 'pending' && transferAmount >= order.amount) {
      await supabase
        .from('accounts')
        .update({ status: 'sold' })
        .eq('id', order.account_id);

      await supabase
        .from('orders')
        .update({ status: 'completed' })
        .eq('id', order.id);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Kiểm tra trạng thái đơn hàng
app.get('/api/order-status/:orderCode', async (req, res) => {
  const { orderCode } = req.params;

  try {
    const { data: order, error } = await supabase
      .from('orders')
      .select('status, account_info')
      .eq('order_code', orderCode.toUpperCase())
      .single();

    if (error || !order) {
      return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    }

    if (order.status === 'completed') {
      return res.json({ status: 'completed', accountInfo: order.account_info });
    }

    res.json({ status: 'pending' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server chạy tại port ${PORT}`);
});
