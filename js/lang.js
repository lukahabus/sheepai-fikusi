(function () {
  'use strict';
  var nav = (navigator.language || navigator.userLanguage || 'hr').toLowerCase();
  var lang = nav.indexOf('hr') === 0 ? 'hr' : 'en';
  document.documentElement.lang = lang;
})();
