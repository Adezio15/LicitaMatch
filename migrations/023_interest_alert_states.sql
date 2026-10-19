-- Empty selection preserves notifications from all states for existing interests.
ALTER TABLE interesses ADD COLUMN estados_alertas text[] NOT NULL DEFAULT '{}'
 CHECK (cardinality(estados_alertas)<=27 AND array_position(estados_alertas,NULL) IS NULL
   AND estados_alertas <@ ARRAY['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']::text[]);
