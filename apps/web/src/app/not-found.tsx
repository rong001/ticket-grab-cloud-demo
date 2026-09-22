import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card" style={{ margin: "2rem auto", maxWidth: 480 }}>
      <h1 className="page-title">页面不存在</h1>
      <p className="lead">请返回首页继续查票。</p>
      <Link href="/">回首页</Link>
    </div>
  );
}
