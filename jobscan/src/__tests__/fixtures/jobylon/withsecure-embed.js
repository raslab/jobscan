




(function(){

var widget_selector = '#jobylon-jobs-widget';


var css_embed = '<style>.jobylon-job-list li,.jobylon-job-list ol,.jobylon-job-list p,.jobylon-job-list ul{font-size:14px;color:#6c6c6c;background-image:none;padding:0}.jobylon-job-list a{color:#03a7d5}.jobylon-job-list .jobylon-job-logo{display:none}.jobylon-job-list .jobylon-job-cover{display:none}.jobylon-job-list .jobylon-job-descr{display:none;padding:0 10px}.jobylon-job-list .jobylon-job-summary{display:none}.jobylon-job-list .jobylon-job-title{font-size:18px;padding:10px}.jobylon-job-list .jobylon-job-title:hover{color:#3498db;cursor:pointer}.jobylon-job-list .jobylon-job{border-bottom:1px solid #ddd}.jobylon-job-list .jobylon-hide{font-size:14px}.jobylon-job-list .jobylon-job-details{list-style:none;margin-left:0;margin-bottom:10px;padding:0}.jobylon-job-list .jobylon-job-details li{font-size:12px;margin-right:20px;margin-left:0;display:inline}.jobylon-job-list .jobylon-apply-btn{background-color:#3498db;-webkit-border-radius:6px;-webkit-background-clip:padding-box;-moz-border-radius:6px;-moz-background-clip:padding;border-radius:6px;background-clip:padding-box;text-indent:0;display:inline-block;color:#fff;font-style:normal;line-height:35px;text-decoration:none;text-align:center;margin:5px 10px 10px 0;padding:0 10px}.jobylon-job-list .jobylon-apply-btn:hover{background-color:#5dade2}.jobylon-job-list .jobylon-apply-btn:active{background-color:#2c81ba}.jobylon-job-list .jobylon-apply-btn.jobylon-actual-apply-btn{display:none}.jobylon-job-list .jobylon-powered-by{font-weight:lighter;font-size:12px;float:right;margin:10px}.jobylon-job-list .jobylon-powered-by a{text-decoration:none;color:#4992fc;font-weight:700}.jobylon-job-list .jobylon-no-jobs{text-align:center;padding:10px 0;border-bottom:1px solid #f2f2f2}#jobylon-jobs-widget .jobylon-pagination{margin:0;margin-top:15px}#jobylon-jobs-widget .jobylon-pagination li{list-style:none;display:inline;border:1px solid #ddd;padding:5px 0}#jobylon-jobs-widget .jobylon-pagination li.active,#jobylon-jobs-widget .jobylon-pagination li:hover{background:#f2f2f2}#jobylon-jobs-widget .jobylon-pagination li a{padding:6px 10px}</style>';


var html_embed = '<div class="jobylon-job-list"><div class="jobylon-job-list-page js-jobylon-page js-jobylon-page-1" ><div id="jobylon-job-387570" class="jobylon-job "><div class="jobylon-job-cover" style="background-image: url(https://media-eu.jobylon.com/CACHE/jobs/company-cover/ws_title/withsecure_people_business-teamee901abc.c752aa16/556c7c7c3cf5ba558ab5780a50f3ff2c.jpg);"></div><div class="jobylon-job-title js-jobylon-toggle">Senior Salesforce Developer</div><div class="jobylon-job-descr js-jobylon-togglable"><ul class="jobylon-job-details"><li class="jobylon-application-date"><strong>Last application date:</strong> Dec. 31, 2026</li><li class="jobylon-location"><strong>Location:</strong> Poznań</li><li class="jobylon-function"><strong>Function:</strong> All functions</li><li class="jobylon-experience"><strong>Experience:</strong> Mid level</li></ul><div class="jobylon-job-excerpt">\u003Cp\u003E\u003C/p\u003E\u000A\u003Cp\u003E\u003Cspan data\u002Dolk\u002Dcopy\u002Dsource\u003D\u0022MessageBody\u0022\u003EAt WithSecure™, we protect businesses all over the world. Our SaaS solutions safeguard against modern cyber threats, and our innovative Co\u002Dsecurity approach reflects our belief that true protection requires collaboration and shared expertise. No one can solve every cyber security problem alone. Our vision is to become Europe’s flagship …\u003C/span\u003E\u003C/p\u003E</div><div class="jobylon-job-summary">NA</div><a class="jobylon-apply-btn" href="https://emp.jobylon.com/jobs/387570-withsecure-senior-salesforce-developer/" target="_blank" rel="noopener"><span class="jobylon-placeholder">Read more</span></a><a class="jobylon-apply-btn jobylon-actual-apply-btn" href="https://emp.jobylon.com/applications/jobs/387570/create/" target="_blank" rel="noopener"><span class="jobylon-placeholder">Apply</span></a><a href="#" class="js-jobylon-hide jobylon-hide">Hide</a></div></div><div id="jobylon-job-384618" class="jobylon-job "><div class="jobylon-job-cover" style="background-image: url(https://media-eu.jobylon.com/CACHE/jobs/company-cover/ws_title/withsecure_people_business-teamee901abc.c752aa16/556c7c7c3cf5ba558ab5780a50f3ff2c.jpg);"></div><div class="jobylon-job-title js-jobylon-toggle">Senior Software Engineer</div><div class="jobylon-job-descr js-jobylon-togglable"><ul class="jobylon-job-details"><li class="jobylon-application-date"><strong>Last application date:</strong> Oct. 23, 2026</li><li class="jobylon-location"><strong>Location:</strong> Poznań</li><li class="jobylon-function"><strong>Function:</strong> All functions</li><li class="jobylon-experience"><strong>Experience:</strong> Mid level</li></ul><div class="jobylon-job-excerpt">\u003Cp\u003E\u003C/p\u003E\u000A\u003Cp\u003E\u003Cspan data\u002Dolk\u002Dcopy\u002Dsource\u003D\u0022MessageBody\u0022\u003EAt WithSecure™, we protect businesses all over the world. Our SaaS solutions safeguard against modern cyber threats, and our innovative Co\u002Dsecurity approach reflects our belief that true protection requires collaboration and shared expertise. No one can solve every cyber security problem alone. Our vision is to become Europe’s flagship …\u003C/span\u003E\u003C/p\u003E</div><div class="jobylon-job-summary">NA</div><a class="jobylon-apply-btn" href="https://emp.jobylon.com/jobs/384618-withsecure-senior-software-engineer/" target="_blank" rel="noopener"><span class="jobylon-placeholder">Read more</span></a><a class="jobylon-apply-btn jobylon-actual-apply-btn" href="https://emp.jobylon.com/applications/jobs/384618/create/" target="_blank" rel="noopener"><span class="jobylon-placeholder">Apply</span></a><a href="#" class="js-jobylon-hide jobylon-hide">Hide</a></div></div><div id="jobylon-job-384545" class="jobylon-job "><div class="jobylon-job-cover" style="background-image: url(https://media-eu.jobylon.com/CACHE/jobs/company-cover/ws_title/withsecure_people_business-teamee901abc.c752aa16/556c7c7c3cf5ba558ab5780a50f3ff2c.jpg);"></div><div class="jobylon-job-title js-jobylon-toggle">Sales Engineer, Partner Growth</div><div class="jobylon-job-descr js-jobylon-togglable"><ul class="jobylon-job-details"><li class="jobylon-application-date"><strong>Last application date:</strong> Oct. 18, 2026</li><li class="jobylon-location"><strong>Location:</strong> Munich</li><li class="jobylon-function"><strong>Function:</strong> All functions</li><li class="jobylon-experience"><strong>Experience:</strong> Mid level</li></ul><div class="jobylon-job-excerpt">\u003Cp\u003E\u003C/p\u003E\u000A\u003Cp\u003E\u003Cspan data\u002Dolk\u002Dcopy\u002Dsource\u003D\u0022MessageBody\u0022\u003EAt WithSecure™, we protect businesses all over the world. Our SaaS solutions safeguard against modern cyber threats, and our innovative Co\u002Dsecurity approach reflects our belief that true protection requires collaboration and shared expertise. No one can solve every cyber security problem alone. Our vision is to become Europe’s flagship …\u003C/span\u003E\u003C/p\u003E</div><div class="jobylon-job-summary">NA</div><a class="jobylon-apply-btn" href="https://emp.jobylon.com/jobs/384545-withsecure-sales-engineer-partner-growth/" target="_blank" rel="noopener"><span class="jobylon-placeholder">Read more</span></a><a class="jobylon-apply-btn jobylon-actual-apply-btn" href="https://emp.jobylon.com/applications/jobs/384545/create/" target="_blank" rel="noopener"><span class="jobylon-placeholder">Apply</span></a><a href="#" class="js-jobylon-hide jobylon-hide">Hide</a></div></div><div id="jobylon-job-383923" class="jobylon-job "><div class="jobylon-job-cover" style="background-image: url(https://media-eu.jobylon.com/CACHE/jobs/company-cover/ws_title/withsecure_people_business-teamee901abc.c752aa16/556c7c7c3cf5ba558ab5780a50f3ff2c.jpg);"></div><div class="jobylon-job-title js-jobylon-toggle">Incident response investigator</div><div class="jobylon-job-descr js-jobylon-togglable"><ul class="jobylon-job-details"><li class="jobylon-application-date"><strong>Last application date:</strong> Jan. 31, 2027</li><li class="jobylon-location"><strong>Location:</strong> London</li><li class="jobylon-function"><strong>Function:</strong> All functions</li><li class="jobylon-experience"><strong>Experience:</strong> Mid level</li></ul><div class="jobylon-job-excerpt">\u003Cp\u003EWithSecure™ delivers research\u002Dled cyber security to defend organizations, society and people from real\u002Dworld attacks and build resilience into their approach. Our people are a mix of technical and creative experts – diverse, talented, and passionate people – working tirelessly to help us advance the industry with new ways of thinking. …\u003C/p\u003E</div><div class="jobylon-job-summary">NA</div><a class="jobylon-apply-btn" href="https://emp.jobylon.com/jobs/383923-withsecure-incident-response-investigator/" target="_blank" rel="noopener"><span class="jobylon-placeholder">Read more</span></a><a class="jobylon-apply-btn jobylon-actual-apply-btn" href="https://emp.jobylon.com/applications/jobs/383923/create/" target="_blank" rel="noopener"><span class="jobylon-placeholder">Apply</span></a><a href="#" class="js-jobylon-hide jobylon-hide">Hide</a></div></div><div id="jobylon-job-383903" class="jobylon-job "><div class="jobylon-job-cover" style="background-image: url(https://media-eu.jobylon.com/CACHE/jobs/company-cover/ws_title/withsecure_people_business-teamee901abc.c752aa16/556c7c7c3cf5ba558ab5780a50f3ff2c.jpg);"></div><div class="jobylon-job-title js-jobylon-toggle">Threat Intelligence Reseacher</div><div class="jobylon-job-descr js-jobylon-togglable"><ul class="jobylon-job-details"><li class="jobylon-application-date"><strong>Last application date:</strong> Dec. 30, 2026</li><li class="jobylon-location"><strong>Location:</strong> Helsinki</li><li class="jobylon-function"><strong>Function:</strong> All functions</li><li class="jobylon-experience"><strong>Experience:</strong> Mid level</li></ul><div class="jobylon-job-excerpt">\u003Cp\u003E\u003C/p\u003E\u000A\u003Cp\u003E\u003Cspan data\u002Dolk\u002Dcopy\u002Dsource\u003D\u0022MessageBody\u0022\u003EAt WithSecure™, we protect businesses all over the world. Our SaaS solutions safeguard against modern cyber threats, and our innovative Co\u002Dsecurity approach reflects our belief that true protection requires collaboration and shared expertise. No one can solve every cyber security problem alone. Our vision is to become Europe’s flagship …\u003C/span\u003E\u003C/p\u003E</div><div class="jobylon-job-summary">NA</div><a class="jobylon-apply-btn" href="https://emp.jobylon.com/jobs/383903-withsecure-threat-intelligence-reseacher/" target="_blank" rel="noopener"><span class="jobylon-placeholder">Read more</span></a><a class="jobylon-apply-btn jobylon-actual-apply-btn" href="https://emp.jobylon.com/applications/jobs/383903/create/" target="_blank" rel="noopener"><span class="jobylon-placeholder">Apply</span></a><a href="#" class="js-jobylon-hide jobylon-hide">Hide</a></div></div><div id="jobylon-job-370764" class="jobylon-job "><div class="jobylon-job-cover" style="background-image: url(https://media-eu.jobylon.com/CACHE/jobs/company-cover/ws_title/withsecure_people_business-teamee901abc.c752aa16/556c7c7c3cf5ba558ab5780a50f3ff2c.jpg);"></div><div class="jobylon-job-title js-jobylon-toggle">Sales Engineer</div><div class="jobylon-job-descr js-jobylon-togglable"><ul class="jobylon-job-details"><li class="jobylon-location"><strong>Location:</strong> Minato City</li><li class="jobylon-function"><strong>Function:</strong> All functions</li><li class="jobylon-experience"><strong>Experience:</strong> Mid level</li></ul><div class="jobylon-job-excerpt">\u003Cp\u003EThe annual salary range for this position is: \u003C/p\u003E\u000A\u003Cp\u003E\u003Cspan data\u002Dolk\u002Dcopy\u002Dsource\u003D\u0022MessageBody\u0022\u003EAt WithSecure™, we protect businesses all over the world. Our SaaS solutions safeguard against modern cyber threats, and our innovative Co\u002Dsecurity approach reflects our belief that true protection requires collaboration and shared expertise. No one can solve every cyber security problem …\u003C/span\u003E\u003C/p\u003E</div><div class="jobylon-job-summary">NA</div><a class="jobylon-apply-btn" href="https://emp.jobylon.com/jobs/370764-withsecure-sales-engineer/" target="_blank" rel="noopener"><span class="jobylon-placeholder">Read more</span></a><a class="jobylon-apply-btn jobylon-actual-apply-btn" href="https://emp.jobylon.com/applications/jobs/370764/create/" target="_blank" rel="noopener"><span class="jobylon-placeholder">Apply</span></a><a href="#" class="js-jobylon-hide jobylon-hide">Hide</a></div></div></div><ul class="jobylon-pagination"></ul><small class="jobylon-powered-by">Powered by <a href="//www.jobylon.com" target="_blank" rel="noopener">Jobylon</a></small></div>';


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
