/// Ruby (iruby) variable introspection. IRuby cells share TOPLEVEL_BINDING,
/// so local variables persist across cells and can be enumerated there.
/// Emits JSON matching the Python shape:
///   { "name": { "name": "x", "type": "Integer", "repr": "42" } }
pub const INSPECT_VARIABLES: &str = r#"
require 'json'

__cf_skip = %w[__cf_skip __cf_out __cf_n __cf_v __cf_info]
__cf_out = {}
(TOPLEVEL_BINDING.local_variables rescue []).each do |__cf_n|
  next if __cf_n.to_s.start_with?('_')
  next if __cf_skip.include?(__cf_n.to_s)
  begin
    __cf_v = TOPLEVEL_BINDING.local_variable_get(__cf_n)
  rescue
    next
  end
  next if __cf_v.is_a?(Method) || __cf_v.is_a?(Proc)

  __cf_info = { name: __cf_n.to_s, type: __cf_v.class.name }
  begin
    if __cf_v.respond_to?(:size) && !__cf_v.is_a?(String) && !__cf_v.is_a?(Numeric)
      __cf_info[:size] = __cf_v.size
      __cf_info[:shape] = __cf_v.size.to_s
    end
    __cf_info[:repr] = __cf_v.inspect[0..500]
  rescue
    __cf_info[:repr] = '<error>'
  end
  __cf_out[__cf_n.to_s] = __cf_info
end

puts __cf_out.to_json
"#;

/// Preview an Array of Hashes (Ruby's closest thing to a dataframe).
pub fn dataframe_preview_code(var_name: &str) -> String {
    format!(
        r#"
require 'json'
begin
  __cf_v = TOPLEVEL_BINDING.local_variable_get(:{var_name}) rescue nil
  if __cf_v.is_a?(Array) && !__cf_v.empty?
    __cf_first = __cf_v.first
    __cf_cols = __cf_first.is_a?(Hash) ? __cf_first.keys.map(&:to_s) : ['value']
    __cf_head = __cf_v.first(50).map do |row|
      row.is_a?(Hash) ? row.transform_keys(&:to_s) : {{ 'value' => row }}
    end
    __cf_dtypes = {{}}
    __cf_cols.each {{ |c| __cf_dtypes[c] = (__cf_head.first[c]&.class&.name || 'NilClass') }}
    puts({{
      columns: __cf_cols,
      dtypes: __cf_dtypes,
      shape: [__cf_v.size, __cf_cols.size],
      head: __cf_head
    }}.to_json)
  else
    puts 'null'
  end
rescue
  puts 'null'
end
"#
    )
}
