const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Kết nối Supabase thông qua biến môi trường trên Render
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 1. API: Lấy danh sách acc còn hàng (ĐÃ THÊM CỘT image_url)
app.get('/api/accounts', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('accounts')
      .select('id, game_name, price, status, image_url') // Duyệt đầy đủ link ảnh
      .eq('status', 'available')
      .order('id', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Lỗi lấy danh sách acc:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2. API: Tạo đơn hàng mới khi khách bấm mua
app.post('/api/create-order', async (req, res) => {
  const { accountId, customerEmail } = req.body;

  try {
    // Kiểm tra tài khoản còn bán không
    const { data: acc, error: accErr } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', accountId)
      .eq('status', 'available')
      .single();

    if (accErr || !acc) {
      return res.status(400).json({ error: 'Tài khoản này vừa có người mua hoặc không tồn tại!' });
    }

    // Sinh mã đơn hàng ngẫu nhiên: DH + 5 chữ số (VD: DH83921)
    const orderCode = 'DH' + Math.floor(10000 + Math.random() * 90000);

    // Lưu thông tin đơn vào bảng orders
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
    console.error('Lỗi tạo đơn hàng:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 3. API: Webhook đón tín hiệu chuyển khoản từ SePay
app.post('/api/webhook/sepay', async (req, res) => {
  const { content, transferAmount } = req.body;
  console.log(`[Webhook SePay] Nhận: ${transferAmount}đ | Nội dung: "${content}"`);

  // Tìm mã đơn DHxxxxx trong nội dung chuyển tiền
  const match = content && content.match(/DH\d+/i);
  if (!match) {
    return res.json({ success: true, message: 'Nội dung không chứa mã đơn hàng hợp lệ' });
  }
  const orderCode = match[0].toUpperCase();

  try {
    // Tìm đơn hàng đang chờ
    const { data: order, error: findErr } = await supabase
      .from('orders')
      .select('*')
      .eq('order_code', orderCode)
      .single();

    if (order && order.status === 'pending' && transferAmount >= order.amount) {
      // 1. Chuyển acc sang sold
      await supabase
        .from('accounts')
        .update({ status: 'sold' })
        .eq('id', order.account_id);

      // 2. Chuyển đơn sang completed
      await supabase
        .from('orders')
        .update({ status: 'completed' })
        .eq('id', order.id);

      console.log(`[Thành công] Đã kích hoạt bàn giao acc cho đơn ${orderCode}!`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Lỗi xử lý webhook:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 4. API: Frontend kiểm tra trạng thái đơn hàng (Polling)
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
  console.log(`Server WuWa Shop đang chạy ở port ${PORT}`);
});
