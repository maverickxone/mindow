// Integration test crate root for property-based tests
#[path = "properties/config_props.rs"]
mod config_props;
#[path = "properties/filter_props.rs"]
mod filter_props;
#[path = "properties/path_props.rs"]
mod path_props;
#[path = "properties/rule_battery_props.rs"]
mod rule_battery_props;
#[path = "properties/rule_high_cpu_props.rs"]
mod rule_high_cpu_props;
#[path = "properties/rule_memory_leak_props.rs"]
mod rule_memory_leak_props;
#[path = "properties/rule_memory_pressure_props.rs"]
mod rule_memory_pressure_props;
#[path = "properties/trend_buffer_props.rs"]
mod trend_buffer_props;
#[path = "properties/alert_props.rs"]
mod alert_props;
