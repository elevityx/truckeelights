import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html>
      <Head>
        {/* Import festive font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Mountains+of+Christmas:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </Head>
      <body className="font-sans">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
