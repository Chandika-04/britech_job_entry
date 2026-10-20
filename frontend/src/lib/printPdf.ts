function finishOnce(run: () => void) {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    run();
  };
}

export function printPdfBlob(blob: Blob): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.title = "Print";
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    const finish = finishOnce(() => {
      window.removeEventListener("focus", onFocus);
      iframe.remove();
      URL.revokeObjectURL(url);
      resolve();
    });
    const onFocus = () => {
      if (started) window.setTimeout(finish, 200);
    };
    let started = false;
    iframe.addEventListener("load", () => {
      const win = iframe.contentWindow;
      if (!win) {
        finish();
        return;
      }
      win.addEventListener("afterprint", finish);
      window.addEventListener("focus", onFocus);
      window.setTimeout(() => {
        started = true;
        try {
          win.focus();
          win.print();
        } catch {
          finish();
        }
      }, 250);
      window.setTimeout(finish, 120000);
    });
    iframe.src = url;
    document.body.appendChild(iframe);
  });
}
