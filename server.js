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

    // 2. Chuyển trạng thái đơn sang 'completed' để frontend nhả acc
    await supabase
      .from('orders')
      .update({ status: 'completed' })
      .eq('id', order.id);

    console.log(`[Hoàn thành] Giao dịch mã ${orderCode} thành công!`);
  }

  res.json({ success: true });
});
