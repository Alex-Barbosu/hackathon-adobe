insert into public.personas (id, description, viewing_mode, category_familiarity) values
  ('heavy_weekly', 'Buys in this category every week, knows the main brands'' looks well', 'considered', 'heavy'),
  ('heavy_scroller', 'Frequent buyer scrolling a social feed quickly', 'glance', 'heavy'),
  ('light_occasional', 'Buys this category a few times a year', 'considered', 'light'),
  ('light_distracted', 'Occasional buyer, watching TV with the phone in hand', 'glance', 'light'),
  ('newcomer_curious', 'Has never bought the category, looks carefully at new things', 'considered', 'none'),
  ('newcomer_skimmer', 'Has never bought the category, barely looks at ads', 'glance', 'none'),
  ('design_literate', 'Works in a visual field, notices typography and colour systems', 'considered', 'light'),
  ('older_loyal', 'Older shopper loyal to one brand for years', 'considered', 'heavy'),
  ('young_switcher', 'Young adult who switches brands based on what is new', 'glance', 'light'),
  ('price_hunter', 'Looks for deals; notices badges and products, not branding', 'glance', 'heavy'),
  ('commuter_ooh', 'Sees the ad on a billboard for two seconds while commuting', 'glance', 'light'),
  ('parent_busy', 'Busy parent shopping for a household, recognises familiar packaging', 'glance', 'heavy')
on conflict (id) do update set description = excluded.description,
  viewing_mode = excluded.viewing_mode, category_familiarity = excluded.category_familiarity;
