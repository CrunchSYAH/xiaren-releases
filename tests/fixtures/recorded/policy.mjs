export const tags = 'div span main section article aside header footer nav p a button input textarea select option label form fieldset legend table thead tbody tfoot tr td th ul ol li h1 h2 h3 h4 h5 h6 strong em small i b br hr img svg symbol path use g circle ellipse line rect polygon polyline defs clipPath mask linearGradient stop'.split(' ');
export const attributes = 'class id role type tabindex disabled readonly hidden checked selected colspan rowspan aria-hidden aria-expanded aria-disabled aria-selected aria-checked data-row-key viewBox d fill stroke stroke-width stroke-linecap stroke-linejoin fill-rule clip-rule x y x1 x2 y1 y2 cx cy r rx ry width height points xmlns preserveAspectRatio offset stop-color transform'.split(' ');
export const styles = 'display position top right bottom left width height min-width max-width min-height max-height margin-top margin-right margin-bottom margin-left padding-top padding-right padding-bottom padding-left box-sizing overflow overflow-x overflow-y color background-color border-top border-right border-bottom border-left border-radius box-shadow font-family font-size font-weight font-style line-height letter-spacing text-align text-decoration white-space word-break vertical-align opacity visibility z-index flex-direction flex-wrap flex-grow flex-shrink flex-basis align-items align-self justify-content gap grid-template-columns grid-template-rows grid-column grid-row transform object-fit'.split(' ');
export const schemas = {
  store: ['shopId', 'shopName', 'username', 'isLoggedIn'],
  props: ['data', 'record', 'buyerId', 'shopId', 'currentConversation', 'currentUser', 'message', 'msg'],
  record: ['affiliateId', 'shopeeUserId', 'displayName', 'username'],
  conversation: ['id', 'to_id', 'shop_id', 'latest_message_id', 'opposite_last_deliver_msg_id'],
  user: ['id'],
  message: ['id', 'message_id', 'from_id', 'to_id', 'from_shop_id', 'status', 'content'],
  content: ['text'],
};

export const publicText = ['Shopee', 'Seller Centre', 'Pusat Penjual', 'Affiliate Marketing', 'Creator Marketplace', 'Marketplace', 'Cari Kreator', 'Cari', 'Filter', 'Reset', 'Chat', 'Kirim', 'Beranda', 'Marketing Centre', 'Cari Nama Pengguna', 'Semua', 'Terbaru', 'Produk', 'Kategori', 'Indonesia', 'Pesan', 'Lihat Profil'];
export const localPaintPattern = String.raw`^url\(\s*['"]?#[^\s'"()<>:/\\]+['"]?\s*\)$`;
