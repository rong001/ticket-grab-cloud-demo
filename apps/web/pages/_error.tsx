import type { NextPageContext } from "next";

function ErrorPage({ statusCode }: { statusCode?: number }) {
  return (
    <div style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>{statusCode || "Error"}</h1>
      <p>页面出错或未找到。</p>
      <a href="/">返回首页</a>
    </div>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  return { statusCode };
};

export default ErrorPage;
