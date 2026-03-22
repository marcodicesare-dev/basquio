type RasterizeSvgInput = {
  svg: string;
  width: number;
  height: number;
  transparent?: boolean;
};

function buildRasterHtml(svg: string, transparent: boolean): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: ${transparent ? "transparent" : "#ffffff"};
      }
      body {
        display: flex;
        align-items: stretch;
        justify-content: stretch;
      }
      #root {
        width: 100%;
        height: 100%;
      }
      #root svg {
        display: block;
        width: 100%;
        height: 100%;
      }
    </style>
  </head>
  <body>
    <div id="root">${svg}</div>
  </body>
</html>`;
}

export async function rasterizeSvgToPng(input: RasterizeSvgInput): Promise<Buffer> {
  const browserlessToken = process.env.BROWSERLESS_TOKEN;
  const browserlessUrl = process.env.BROWSERLESS_URL || "https://production-sfo.browserless.io";

  if (!browserlessToken) {
    throw new Error("BROWSERLESS_TOKEN is required for chart rasterization.");
  }

  const html = buildRasterHtml(input.svg, input.transparent ?? false);
  const response = await fetch(`${browserlessUrl}/screenshot?token=${browserlessToken}`, {
    method: "POST",
    headers: {
      "Cache-Control": "no-cache",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      html,
      options: {
        type: "png",
        omitBackground: input.transparent ?? false,
        clip: {
          x: 0,
          y: 0,
          width: input.width,
          height: input.height,
        },
      },
      viewport: {
        width: input.width,
        height: input.height,
        deviceScaleFactor: 1,
      },
      gotoOptions: {
        waitUntil: "networkidle0",
        timeout: 30_000,
      },
    }),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Browserless screenshot failed: ${response.status} ${message}`);
  }

  return Buffer.from(await response.arrayBuffer());
}
