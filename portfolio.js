// 브랜드 담당자가 관리자에서 작성한 포트폴리오를 공개 페이지에 표시합니다.
// 학생은 portfolio.html과 style.css로 UI를 디자인하고, 이 로딩·보안 코드는 유지하세요.
(function () {
  "use strict";

  const root = document.getElementById("portfolioContent");
  if (!root) return;

  loadPortfolio();

  async function loadPortfolio() {
    try {
      const response = await fetch("portfolio.json", { cache: "no-store" });
      if (!response.ok) throw new Error("포트폴리오를 불러오지 못했습니다.");
      const data = await response.json();
      const sanitize = window.ProductCatalog?.sanitizeRichText;
      if (typeof sanitize !== "function") throw new Error("포트폴리오 표시 기능을 준비하지 못했습니다.");
      const body = sanitize(data && data.body || "").trim();
      if (!body) {
        root.classList.add("is-empty");
        root.innerHTML = '<p class="portfolio-status">등록된 포트폴리오 내용이 없습니다.</p>';
        return;
      }
      root.classList.remove("is-empty");
      root.innerHTML = body;
    } catch (error) {
      root.classList.add("is-empty");
      root.innerHTML = '<p class="portfolio-status">포트폴리오를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.</p>';
      console.error(error);
    }
  }
})();
