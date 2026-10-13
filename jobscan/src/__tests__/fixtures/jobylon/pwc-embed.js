




(function(){

var widget_selector = '#jobylon-jobs-widget';


var css_embed = '<style>.jobylon-job-list li,.jobylon-job-list ol,.jobylon-job-list p,.jobylon-job-list ul{font-size:14px;color:#6c6c6c;background-image:none;padding:0}.jobylon-job-list a{color:#03a7d5}.jobylon-job-list .jobylon-job-logo{display:none}.jobylon-job-list .jobylon-job-cover{display:none}.jobylon-job-list .jobylon-job-descr{display:none;padding:0 10px}.jobylon-job-list .jobylon-job-summary{display:none}.jobylon-job-list .jobylon-job-title{font-size:18px;padding:10px}.jobylon-job-list .jobylon-job-title:hover{color:#3498db;cursor:pointer}.jobylon-job-list .jobylon-job{border-bottom:1px solid #ddd}.jobylon-job-list .jobylon-hide{font-size:14px}.jobylon-job-list .jobylon-job-details{list-style:none;margin-left:0;margin-bottom:10px;padding:0}.jobylon-job-list .jobylon-job-details li{font-size:12px;margin-right:20px;margin-left:0;display:inline}.jobylon-job-list .jobylon-apply-btn{background-color:#3498db;-webkit-border-radius:6px;-webkit-background-clip:padding-box;-moz-border-radius:6px;-moz-background-clip:padding;border-radius:6px;background-clip:padding-box;text-indent:0;display:inline-block;color:#fff;font-style:normal;line-height:35px;text-decoration:none;text-align:center;margin:5px 10px 10px 0;padding:0 10px}.jobylon-job-list .jobylon-apply-btn:hover{background-color:#5dade2}.jobylon-job-list .jobylon-apply-btn:active{background-color:#2c81ba}.jobylon-job-list .jobylon-apply-btn.jobylon-actual-apply-btn{display:none}.jobylon-job-list .jobylon-powered-by{font-weight:lighter;font-size:12px;float:right;margin:10px}.jobylon-job-list .jobylon-powered-by a{text-decoration:none;color:#4992fc;font-weight:700}.jobylon-job-list .jobylon-no-jobs{text-align:center;padding:10px 0;border-bottom:1px solid #f2f2f2}#jobylon-jobs-widget .jobylon-pagination{margin:0;margin-top:15px}#jobylon-jobs-widget .jobylon-pagination li{list-style:none;display:inline;border:1px solid #ddd;padding:5px 0}#jobylon-jobs-widget .jobylon-pagination li.active,#jobylon-jobs-widget .jobylon-pagination li:hover{background:#f2f2f2}#jobylon-jobs-widget .jobylon-pagination li a{padding:6px 10px}</style>';


var html_embed = '<div class="jobylon-job-list"><div class="jobylon-job-list-page js-jobylon-page js-jobylon-page-1" ><div id="jobylon-job-386840" class="jobylon-job "><div class="jobylon-job-cover" style="background-image: url(https://media-eu.jobylon.com/CACHE/assets_media/companies/502/pwcbanner.659aac7f/474730d083b8fc8dc4893e569612ac20.jpg);"></div><div class="jobylon-job-title js-jobylon-toggle">Decarbonization &amp; Clean Transition - Business &amp; Supply Chain Operations, Director / Senior Manager</div><div class="jobylon-job-descr js-jobylon-togglable"><ul class="jobylon-job-details"><li class="jobylon-application-date"><strong>Viimeinen hakupäivä:</strong> 18. lokakuuta 2026</li><li class="jobylon-location"><strong>Sijainti:</strong> Helsinki</li><li class="jobylon-function"><strong>Työtehtävät:</strong> Muu</li><li class="jobylon-experience"><strong>Kokemus:</strong> Kokenut</li></ul><div class="jobylon-job-excerpt">\u003Cp\u003EPwC Advisory’s Business \u0026amp\u003B Supply Chain Operations team helps industrial companies improve growth, operations, supply chains, productivity and resilience. We support clients from analysis through major business transformations. \u003C/p\u003E\u000A\u003Cp\u003EWithin the team, this role brings expertise in \u003Cstrong\u003Edecarbonization, clean transition and regulation\u003C/strong\u003E. The work combines transformation consulting, commercial and …\u003C/p\u003E</div><div class="jobylon-job-summary"></div><a class="jobylon-apply-btn" href="https://emp.jobylon.com/jobs/386840-pwc-decarbonization-clean-transition-business-supply-chain-operations-director-senior-manager/" target="_blank" rel="noopener"><span class="jobylon-placeholder">Lue lisää</span></a><a class="jobylon-apply-btn jobylon-actual-apply-btn" href="https://emp.jobylon.com/applications/jobs/386840/create/" target="_blank" rel="noopener"><span class="jobylon-placeholder">Hae paikkaa</span></a><a href="#" class="js-jobylon-hide jobylon-hide">Piilota</a></div></div><div id="jobylon-job-384771" class="jobylon-job "><div class="jobylon-job-cover" style="background-image: url(https://media-eu.jobylon.com/CACHE/assets_media/companies/502/pwcbanner.659aac7f/474730d083b8fc8dc4893e569612ac20.jpg);"></div><div class="jobylon-job-title js-jobylon-toggle">Data Governance -konsultti</div><div class="jobylon-job-descr js-jobylon-togglable"><ul class="jobylon-job-details"><li class="jobylon-application-date"><strong>Viimeinen hakupäivä:</strong> 18. lokakuuta 2026</li><li class="jobylon-location"><strong>Sijainti:</strong> Helsinki</li><li class="jobylon-function"><strong>Työtehtävät:</strong> Muu</li><li class="jobylon-experience"><strong>Kokemus:</strong> Keskitaso</li></ul><div class="jobylon-job-excerpt">\u003Cp\u003E\u003Cstrong\u003ERakenna pelisäännöt datalle ja tekoälylle aikakaudella, jolloin kaikki muuttuu.\u003C/strong\u003E\u003C/p\u003E\u000A\u003Cp\u003ETekoäly muuttaa jokaisen toimialan, mutta ilman hallintamallia se jää lupaukseksi. PwC:llä pääset rakentamaan Data \u0026amp\u003B AI Governance \u002Dtoimintamalleja organisaatioille, jotka haluavat hyödyntää dataa ja tekoälyä vastuullisesti, tehokkaasti ja skaalautuvasti. Etsimme asiantuntijaa, joka osaa luoda näitä rakenteita tyhjästä, fasilitoida senioritason päätöksentekoa …\u003C/p\u003E</div><div class="jobylon-job-summary"></div><a class="jobylon-apply-btn" href="https://emp.jobylon.com/jobs/384771-pwc-data-governance-konsultti/" target="_blank" rel="noopener"><span class="jobylon-placeholder">Lue lisää</span></a><a class="jobylon-apply-btn jobylon-actual-apply-btn" href="https://emp.jobylon.com/applications/jobs/384771/create/" target="_blank" rel="noopener"><span class="jobylon-placeholder">Hae paikkaa</span></a><a href="#" class="js-jobylon-hide jobylon-hide">Piilota</a></div></div><div id="jobylon-job-4091" class="jobylon-job "><div class="jobylon-job-cover" style="background-image: url(https://media-eu.jobylon.com/CACHE/assets_media/companies/502/pwcbanner.659aac7f/474730d083b8fc8dc4893e569612ac20.jpg);"></div><div class="jobylon-job-title js-jobylon-toggle">Avoin hakemus / Open Application</div><div class="jobylon-job-descr js-jobylon-togglable"><ul class="jobylon-job-details"><li class="jobylon-function"><strong>Työtehtävät:</strong> Kaikki tehtäväalueet</li><li class="jobylon-experience"><strong>Kokemus:</strong> Ei vaatimuksia</li></ul><div class="jobylon-job-excerpt">\u003Cp\u003E\u003Ci\u003EIn English below\u003C/i\u003E\u003C/p\u003E\u000A\u003Cp\u003E\u003Cstrong\u003ETöihin PwC:lle? \u003C/strong\u003E\u003C/p\u003E\u000A\u003Cp\u003EJos sinulle ei ole juuri nyt avoimia paikkoja, ei hätää \u002D etsimme jatkuvasti uusia kollegoita erilaisista taustoista liittymään joukkoomme! Kurkkaa siis kaikki avoimet työpaikkamme tai lähetä meille avoin hakemus. Käymme hakemuksia läpi päivittäin ja otamme yhteyttä, jos löydämme jotain, joka sopii taitoihisi ja …\u003C/p\u003E</div><div class="jobylon-job-summary"></div><a class="jobylon-apply-btn" href="https://emp.jobylon.com/jobs/4091-pwc-avoin-hakemus-open-application/" target="_blank" rel="noopener"><span class="jobylon-placeholder">Lue lisää</span></a><a class="jobylon-apply-btn jobylon-actual-apply-btn" href="https://emp.jobylon.com/applications/jobs/4091/create/" target="_blank" rel="noopener"><span class="jobylon-placeholder">Hae paikkaa</span></a><a href="#" class="js-jobylon-hide jobylon-hide">Piilota</a></div></div></div><ul class="jobylon-pagination"></ul><small class="jobylon-powered-by">Powered by <a href="//www.jobylon.com" target="_blank" rel="noopener">Jobylon</a></small></div>';


main = function() {
  const adjustedWidgetId = widget_selector.substring(1);
  const widget = document.getElementById(adjustedWidgetId);
  widget.insertAdjacentHTML('beforebegin', css_embed);
  widget.insertAdjacentHTML('afterbegin', html_embed);

  // set up pagination counter
  const paginationMap = new WeakMap()
  let paginationButtons = document.querySelectorAll('.js-jobylon-show-page');
  paginationButtons.forEach((page) => {
    // get the data-attribute for each page and store the value
    // in the weakmap
    let pageNumber = page.getAttribute('data-page');
    paginationMap.set(page, pageNumber);
  });

  document.addEventListener('click', function (event) {
    if (event.target.matches('.js-jobylon-toggle')) {
      event.preventDefault();
      let targetParent = event.target.parentElement;
      let toggable = targetParent.querySelector('.js-jobylon-togglable');
      // get current display type for toggling reasons
      let currentDisplay = toggable.style.display;
      if (currentDisplay == 'none' || currentDisplay == '') {
        toggable.style.display='block';
      } else {
        toggable.style.display='none';
      }
    }

    if(event.target.matches('.js-jobylon-hide')) {
      event.preventDefault();
      let targetParent = event.target.parentElement;
      targetParent.setAttribute('style', 'display:none;');
    }

    if(event.target.matches('.js-jobylon-show-page')) {
      event.preventDefault();
      // get what page the clicked pagination number is
      let page_num = paginationMap.get(event.target);

      // hide all pages
      let jobPages = widget.querySelectorAll('.js-jobylon-page');
      jobPages.forEach((page) => {
        page.style.setProperty('display', 'none', 'important');
      });

      // make the "selected page" visible
      widget.querySelector('.js-jobylon-page-' + page_num).style.display = "block";

      // Remove "active" styling from all the pagination numbers
      let paginationPages = widget.querySelectorAll('.js-jobylon-page-link');
      paginationPages.forEach((paginationPage) => {
        paginationPage.classList.remove("active");
      });

      // add "active" style to the selected page
      widget.querySelector('.js-jobylon-page-link-' + page_num).classList.add("active");
    }

    return;
  });
};

main();


})();
