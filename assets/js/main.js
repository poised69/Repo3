/* ==========================================================================
   Poised Automation, page interactions
   No dependencies. Everything degrades to a working static page.
   ========================================================================== */
(function () {
  'use strict';

  /* Where contact-form submissions go, in order of preference:
       1. FORM_ENDPOINT below, if set (a Formspree URL, a serverless function,
          a Make.com webhook, or anything that accepts a JSON POST).
       2. Netlify Forms, picked up automatically when the site is hosted on
          Netlify (the form carries data-netlify="true").
       3. The visitor's own mail client, pre-filled. Always works, anywhere. */
  var FORM_ENDPOINT = '';
  var EMAIL = 'poisedautomation@gmail.com';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ── Sticky nav ─────────────────────────────────────────── */
  var nav = document.getElementById('nav');
  var onScroll = function () {
    if (nav) nav.classList.toggle('is-stuck', window.scrollY > 24);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ── Mobile menu ────────────────────────────────────────── */
  var toggle = document.getElementById('navToggle');
  var menu = document.getElementById('mobileMenu');
  if (toggle && menu) {
    var setMenu = function (open) {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      menu.hidden = !open;
    };
    toggle.addEventListener('click', function () {
      setMenu(toggle.getAttribute('aria-expanded') !== 'true');
    });
    menu.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') setMenu(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setMenu(false);
        toggle.focus();
      }
    });
  }

  /* ── Scroll reveals (staggered) ─────────────────────────── */
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduceMotion.matches) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        var siblings = Array.prototype.filter.call(
          el.parentNode ? el.parentNode.children : [],
          function (n) { return n.classList && n.classList.contains('reveal'); }
        );
        var i = Math.min(siblings.indexOf(el), 5);
        el.style.transitionDelay = (i > 0 ? i * 90 : 0) + 'ms';
        el.classList.add('is-in');
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    Array.prototype.forEach.call(reveals, function (el) { io.observe(el); });
  } else {
    Array.prototype.forEach.call(reveals, function (el) { el.classList.add('is-in'); });
  }

  /* ── Active section in nav ──────────────────────────────── */
  var links = document.querySelectorAll('.nav__links a[href^="#"]');
  if (links.length && 'IntersectionObserver' in window) {
    var byId = {};
    Array.prototype.forEach.call(links, function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var a = byId[entry.target.id];
        if (!a) return;
        if (entry.isIntersecting) {
          Array.prototype.forEach.call(links, function (l) { l.classList.remove('is-active'); });
          a.classList.add('is-active');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(byId).forEach(function (id) {
      var section = document.getElementById(id);
      if (section) spy.observe(section);
    });
  }

  /* ── Ambient sky canvas ─────────────────────────────────── */
  var canvas = document.getElementById('skyCanvas');
  if (canvas && !reduceMotion.matches) {
    var ctx = canvas.getContext('2d');
    var hero = document.getElementById('hero');
    var w = 0, h = 0, dpr = 1, raf = null, running = false;
    var motes = [], drifts = [];
    var pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };

    var rand = function (min, max) { return min + Math.random() * (max - min); };

    var build = function () {
      var small = window.innerWidth < 700;
      var moteCount = small ? 18 : 46;
      motes = [];
      for (var i = 0; i < moteCount; i++) {
        motes.push({
          x: Math.random(), y: Math.random(),
          r: rand(0.7, 2.2),
          vx: rand(-0.045, 0.055) / 100,
          vy: rand(-0.03, 0.02) / 100,
          a: rand(0.16, 0.5),
          hue: Math.random() > 0.82 ? 'accent' : 'sky'
        });
      }
      drifts = [
        { x: 0.18, y: 0.28, r: 0.42, s: 0.00006, p: 0.0, c: [126, 200, 227, 0.20] },
        { x: 0.74, y: 0.20, r: 0.36, s: 0.00009, p: 2.1, c: [173, 183, 226, 0.16] },
        { x: 0.52, y: 0.78, r: 0.46, s: 0.00005, p: 4.2, c: [242, 164, 136, 0.09] }
      ];
      if (small) drifts = drifts.slice(0, 2);
    };

    var resize = function () {
      if (!hero) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = hero.clientWidth;
      h = hero.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    };

    /* ~30fps is plenty for drifting clouds and halves the main-thread cost */
    var FRAME_MS = 33;
    var last = 0;
    var t = 0;
    var frame = function (now) {
      raf = window.requestAnimationFrame(frame);
      if (now - last < FRAME_MS) return;
      last = now || 0;

      t += 2;
      ctx.clearRect(0, 0, w, h);

      pointer.x += (pointer.tx - pointer.x) * 0.04;
      pointer.y += (pointer.ty - pointer.y) * 0.04;
      var px = (pointer.x - 0.5) * 26;
      var py = (pointer.y - 0.5) * 18;

      /* slow soft clouds */
      for (var i = 0; i < drifts.length; i++) {
        var d = drifts[i];
        var cx = (d.x + Math.sin(t * d.s * 60 + d.p) * 0.05) * w + px * (i + 1) * 0.4;
        var cy = (d.y + Math.cos(t * d.s * 48 + d.p) * 0.04) * h + py * (i + 1) * 0.4;
        var rad = d.r * Math.min(w, h) * (1 + Math.sin(t * d.s * 30 + d.p) * 0.06);
        var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        g.addColorStop(0, 'rgba(' + d.c[0] + ',' + d.c[1] + ',' + d.c[2] + ',' + d.c[3] + ')');
        g.addColorStop(1, 'rgba(' + d.c[0] + ',' + d.c[1] + ',' + d.c[2] + ',0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      /* drifting light dust */
      for (var j = 0; j < motes.length; j++) {
        var m = motes[j];
        m.x += m.vx; m.y += m.vy;
        if (m.x < -0.05) m.x = 1.05; if (m.x > 1.05) m.x = -0.05;
        if (m.y < -0.05) m.y = 1.05; if (m.y > 1.05) m.y = -0.05;
        var bob = Math.sin((t + j * 40) * 0.006) * 3;
        ctx.beginPath();
        ctx.arc(m.x * w + px * 0.6, m.y * h + bob + py * 0.6, m.r, 0, Math.PI * 2);
        ctx.fillStyle = m.hue === 'accent'
          ? 'rgba(242,164,136,' + m.a * 0.85 + ')'
          : 'rgba(90,160,190,' + m.a + ')';
        ctx.fill();
      }
    };

    var start = function () {
      if (running) return;
      running = true;
      raf = window.requestAnimationFrame(frame);
    };
    var stop = function () {
      running = false;
      if (raf) window.cancelAnimationFrame(raf);
      raf = null;
    };

    resize();
    /* let the page finish painting and settling before the ambient layer starts */
    var kickoff = function () {
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(start, { timeout: 1200 });
      } else {
        window.setTimeout(start, 300);
      }
    };
    if (document.readyState === 'complete') kickoff();
    else window.addEventListener('load', kickoff, { once: true });

    var resizeTimer;
    window.addEventListener('resize', function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 180);
    });

    /* pause when the hero scrolls away or the tab is hidden */
    var heroVisible = true;
    var sync = function () {
      if (heroVisible && !document.hidden) start(); else stop();
    };
    if ('IntersectionObserver' in window && hero) {
      new IntersectionObserver(function (entries) {
        heroVisible = entries[0].isIntersecting;
        sync();
      }, { threshold: 0 }).observe(hero);
    }
    document.addEventListener('visibilitychange', sync);

    /* subtle cursor parallax (pointer devices only) */
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      window.addEventListener('mousemove', function (e) {
        pointer.tx = e.clientX / window.innerWidth;
        pointer.ty = e.clientY / window.innerHeight;
      }, { passive: true });
    }
  }

  /* ── Contact form ───────────────────────────────────────── */
  var form = document.getElementById('contactForm');
  if (form) {
    var status = document.getElementById('formStatus');
    var submit = document.getElementById('submitBtn');

    var showError = function (name, show) {
      var msg = form.querySelector('[data-err="' + name + '"]');
      var input = form.elements[name];
      if (msg) msg.hidden = !show;
      if (input) input.setAttribute('aria-invalid', show ? 'true' : 'false');
    };

    var validate = function () {
      var ok = true;
      var name = form.elements.name.value.trim();
      var email = form.elements.email.value.trim();
      var task = form.elements.task.value.trim();

      showError('name', !name); if (!name) ok = false;
      var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
      showError('email', !emailOk); if (!emailOk) ok = false;
      showError('task', !task); if (!task) ok = false;
      return ok;
    };

    ['name', 'email', 'task'].forEach(function (n) {
      var el = form.elements[n];
      if (el) el.addEventListener('input', function () {
        if (el.getAttribute('aria-invalid') === 'true') validate();
      });
    });

    var say = function (text, kind) {
      status.textContent = text;
      status.className = 'form__status' + (kind ? ' is-' + kind : '');
    };

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var hp = form.elements['bot-field'];
      if (hp && hp.value) return; /* honeypot filled, silently drop */

      if (!validate()) {
        say('Just a couple of fields to fix above.', 'err');
        var firstBad = form.querySelector('[aria-invalid="true"]');
        if (firstBad) firstBad.focus();
        return;
      }

      var data = {
        name: form.elements.name.value.trim(),
        email: form.elements.email.value.trim(),
        task: form.elements.task.value.trim()
      };

      var mailtoFallback = function (note) {
        var subject = 'Automation enquiry from ' + data.name;
        var body = 'Name: ' + data.name + '\nEmail: ' + data.email +
                   '\n\nThe repetitive task:\n' + data.task + '\n';
        window.location.href = 'mailto:' + EMAIL +
          '?subject=' + encodeURIComponent(subject) +
          '&body=' + encodeURIComponent(body);
        say(note || ('Opening your email app with the message ready to send. ' +
            'If nothing happens, write to ' + EMAIL + '.'), 'ok');
      };

      var sent = function () {
        form.reset();
        say('Got it, thank you. You\'ll hear back from us within a day.', 'ok');
      };

      /* 1. an explicit endpoint (Formspree or similar) wins */
      if (FORM_ENDPOINT) {
        submit.disabled = true;
        say('Sending…');
        fetch(FORM_ENDPOINT, {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        }).then(function (res) {
          if (!res.ok) throw new Error('bad response');
          sent();
        }).catch(function () {
          mailtoFallback('Couldn\'t reach the form service. Opening your email app instead.');
        }).then(function () {
          submit.disabled = false;
        });
        return;
      }

      /* 2. Netlify Forms, if the site is hosted there */
      if (form.hasAttribute('data-netlify')) {
        submit.disabled = true;
        say('Sending…');
        var encoded = new URLSearchParams();
        encoded.append('form-name', 'contact');
        Object.keys(data).forEach(function (k) { encoded.append(k, data[k]); });
        fetch(window.location.pathname, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: encoded.toString()
        }).then(function (res) {
          if (!res.ok) throw new Error('bad response');
          sent();
        }).catch(function () {
          /* not on Netlify, or forms are disabled, so hand it to the mail client */
          mailtoFallback();
        }).then(function () {
          submit.disabled = false;
        });
        return;
      }

      /* 3. plain mailto */
      mailtoFallback();
    });
  }

  /* ── Footer year ────────────────────────────────────────── */
  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
