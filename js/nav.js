document.querySelectorAll(".mobile-nav a").forEach(function (link) {
  link.addEventListener("click", function () {
    var menu = link.closest("details");
    if (menu) menu.open = false;
  });
});
