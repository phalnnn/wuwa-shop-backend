const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// CẤU HÌNH SUPABASE TRỰC TIẾP
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://okfuncwyrjgeqddunzal.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rZnVuY3d5cmpnZXFkZHVuemFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMDg4MjIsImV4cCI6MjEwNDc4NDgyMn0.Dpfz63DUcSRrch88afPz_u3MH9C0m7qeCi-JoU1mi8M';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 1. API LẤY DANH SÁCH TÀI KHOẢN CÒN HÀNG
app.get('/api/accounts', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('accounts')
      .select('id, game_name, price, status, image_url')
      .eq('status', 'available')
      .order('id', { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Lỗi lấy accounts:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2. API TẠO ĐƠN HÀNG
app.post('/api/create-order', async (req, res) => {
  try {
    const { accountId, customerEmail } = req.body;

    const { data: account, error: accErr } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', accountId)
      .eq('status', 'available')
      .single();

    if (accErr || !account) {
      return res.status(400).json({ error: 'Tài khoản này vừa có người mua hoặc không tồn tại!' });
    }

    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const orderCode = `DH${randomSuffix}`;

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert([
        {
          order_code: orderCode,
          account_id: account.id,
          amount: account.price,
          status: 'pending',
          customer_email: customerEmail || 'gamer@local.shop'
        }
      ])
      .select()
      .single();

    if (orderErr) throw orderErr;

    res.json({
      orderCode: order.order_code,
      amount: order.amount,
      gameName: account.game_name
    });
  } catch (err) {
    console.error('Lỗi tạo đơn:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 3. API KIỂM TRA TRẠNG THÁI ĐƠN HÀNG (POLLING TỪ WEB)
app.get('/api/order-status/:orderCode', async (req, res) => {
  try {
    const { orderCode } = req.params;

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('status, account_id')
      .eq('order_code', orderCode)
      .single();

    if (orderErr || !order) {
      return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    }

    if (order.status === 'completed') {
      const { data: account } = await supabase
        .from('accounts')
        .select('account_info')
        .eq('id', order.account_id)
        .single();

      return res.json({
        status: 'completed',
        accountInfo: account ? account.account_info : 'Đã bàn giao tài khoản'
      });
    }

    res.json({ status: order.status });
  } catch (err) {
    console.error('Lỗi kiểm tra trạng thái đơn:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 4. WEBHOOK NHẬN TIỀN TỰ ĐỘNG TỪ SEPAY (BẮT ĐA DẠNG TRƯỜNG DỮ LIỆU)
app.post('/api/sepay-webhook', async (req, res) => {
  try {
    const body = req.body || {};
    console.log('>>> [SePay Webhook Received]:', JSON.stringify(body));

    // Lấy nội dung chuyển khoản từ mọi tên biến có thể có
    const rawContent = body.content || body.description || body.transferContent || body.order_code || '';
    
    // Lấy số tiền chuyển khoản từ mọi tên biến có thể có
    const rawAmount = body.transferAmount || body.amount || body.transfer_amount || body.accumulated || 0;
    const transferAmount = Number(rawAmount);

    if (!rawContent) {
      console.warn('Webhook thiếu trường nội dung');
      return res.status(200).json({ success: false, message: 'Thiếu nội dung giao dịch' });
    }

    // Trích xuất mã đơn DHxxxx từ nội dung chuyển khoản
    const match = String(rawContent).match(/DH\d{4}/i);
    if (!match) {
      console.warn('Không tìm thấy mã đơn dạng DHxxxx trong chuỗi:', rawContent);
      return res.status(200).json({ success: false, message: 'Nội dung không chứa mã đơn hàng' });
    }

    const orderCode = match[0].toUpperCase();
    console.log(`Tìm thấy mã đơn: ${orderCode} | Số tiền nhận: ${transferAmount}`);

    // Tìm đơn hàng đang chờ thanh toán
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('*')
      .eq('order_code', orderCode)
      .eq('status', 'pending')
      .single();

    if (orderErr || !order) {
      console.warn(`Đơn hàng ${orderCode} không tồn tại hoặc đã xử lý trước đó.`);
      return res.status(200).json({ success: false, message: 'Đơn không tồn tại hoặc đã xử lý' });
    }

    // Đối soát số tiền (cho phép bằng hoặc lớn hơn giá niêm yết)
    if (transferAmount >= Number(order.amount)) {
      // Cập nhật trạng thái đơn hàng thành completed
      await supabase
        .from('orders')
        .update({ status: 'completed' })
        .eq('id', order.id);

      // Cập nhật tài khoản sang sold (đã bán)
      await supabase
        .from('accounts')
        .update({ status: 'sold' })
        .eq('id', order.account_id);

      console.log(`>>> GIAO DỊCH THÀNH CÔNG: Đã duyệt đơn hàng ${orderCode} thành công!`);
      return res.status(200).json({ success: true, message: 'Thành công' });
    } else {
      console.warn(`Số tiền chưa đủ: Yêu cầu ${order.amount}, nhận được ${transferAmount}`);
      return res.status(200).json({ success: false, message: 'Số tiền chuyển không đủ' });
    }
  } catch (err) {
    console.error('Lỗi nghiêm trọng tại webhook:', err.message);
    // Luôn trả về 200 để SePay không gửi spam lại liên tục khi code gặp lỗi logic
    res.status(200).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
