import {
  Alert,
  Button,
  Card,
  ConfigProvider,
  Form,
  Input,
  message,
  Modal,
  notification,
  Popconfirm,
  Spin,
  Table,
  Tag,
} from 'antd';
import zhCN from 'antd/lib/locale/zh_CN';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { GlobalOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';

import './index.less';

const ipRegExp = /^((2(5[0-5]|[0-4]\d))|[0-1]?\d{1,2})(\.((2(5[0-5]|[0-4]\d))|[0-1]?\d{1,2})){3}$/;

const {
  netshSetAddress,
  netshSetAddressDhcp,
  netshShowAddress,
  networkInterfaces,
  ztools: { isWindows, dbStorage },
} = window as any;

const localStorage = dbStorage;

const normalizeScheme = (item: any) => ({
  ...item,
  address: item?.address || '',
  netmask: item?.netmask || '',
  gateway: item?.gateway || '',
  dns: item?.dns || '',
  dns2: item?.dns2 || '',
  remark: item?.remark || '',
});

const isSameScheme = (left: any, right: any) =>
  left.address === right.address &&
  left.netmask === right.netmask &&
  left.gateway === right.gateway &&
  left.dns === right.dns &&
  left.dns2 === right.dns2 &&
  left.remark === right.remark;

export default function IndexPage() {
  const [tabKey, setTabKey] = useState('');
  const [tabList, setTabList] = useState([] as any[]);
  const [current, setCurrent] = useState({} as any);
  const [data, setData] = useState([] as any[]);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editKey, setEditKey] = useState(undefined);

  const isLoading = useRef(false);

  const alertMessage = useMemo(() => {
    const { address, netmask, gateway = '无', mac } = current;
    return address
      ? `IP：${address}，子网掩码：${netmask}，网关：${gateway}，MAC：${mac}。`
      : '设置获取中，请稍候……';
  }, [current]);

  const [form] = Form.useForm();

  const checkEnv = useCallback(() => {
    if (!isWindows()) {
      Modal.error({
        title: '暂不支持',
        content: '很抱歉，当前工具暂时仅支持 Windows 系统，敬请关注后续更新。',
      });
      return;
    }
  }, []);

  const loadTabList = useCallback(async () => {
    if (current.address || isLoading.current) {
      return;
    }
    try {
      isLoading.current = true;

      let obj = {};
      let key = '';
      const { data } = await netshShowAddress();
      const array = data.split('\n');
      array.forEach((str) => {
        if (str.indexOf('"') >= 0) {
          const res = /"(.*)"/.exec(str);
          key = res ? res[1] : '';
        } else {
          const s = str.toLowerCase();
          if (s.indexOf('dhcp') >= 0) {
            if (!obj[key]) {
              obj[key] = {};
            }
            obj[key]['dhcp'] = s.indexOf('yes') >= 0;
          } else if (s.indexOf('gateway:') >= 0) {
            if (!obj[key]) {
              obj[key] = {};
            }
            obj[key]['gateway'] = s.split(':')[1].trim();
          }
        }
      });

      const list = Object.entries(networkInterfaces())
        .map(([tab, val]) => {
          let net = (val as any[]).find((v) => v.family === 'IPv4') || {};
          if (obj[tab]) {
            net = { ...net, ...obj[tab] };
          }
          return { tab, key: tab, ...net };
        })
        .filter((net) => net.address !== '127.0.0.1');

      if (!tabKey && list.length) {
        setTabKey(list[0].key);
      }
      setTabList(list);

      isLoading.current = false;
    } catch (err) {
      console.log('网卡信息获取失败:', err);
      if (err.data) {
        notification.error({
          message: '网卡信息获取失败，请使用拥有管理员权限的帐户登录系统。',
          description: err.data.trim().split('\n').pop(),
          duration: 0,
        });
      } else {
        message.error('网卡信息获取失败，请使用拥有管理员权限的帐户登录系统。', 0);
      }
    }
  }, [current, tabKey]);

  const loadData = useCallback((key) => {
    if (key) {
      const _data = localStorage.getItem(key);
      if (_data) {
        const arr = JSON.parse(_data);
        if (Array.isArray(arr)) {
          setData(arr.map(normalizeScheme));
          return;
        }
      }
    }
    setData([]);
  }, []);

  const showModal = useCallback(
    (record?: any) => {
      form.resetFields();
      if (!!record) {
        form.setFieldsValue(normalizeScheme(record));
      }
      setEditKey(record ? record.key : undefined);
      setIsModalVisible(true);
    },
    [form],
  );

  const handleOk = useCallback(async () => {
    try {
      const values = normalizeScheme(await form.validateFields());
      if (!values.address && !values.netmask && !values.dns && !values.dns2) {
        message.info('请至少填写 IP 信息或 DNS 信息');
        return;
      }
      if ((values.address && !values.netmask) || (!values.address && values.netmask)) {
        message.info('IP 地址和子网掩码需要同时填写');
        return;
      }

      const index = data.findIndex((item) => isSameScheme(item, values));
      if (index !== -1 && data[index].key !== editKey) {
        message.info('当前方案已经存在');
        return;
      }

      const newData = [...data];
      if (editKey) {
        const idx = newData.findIndex((item) => item.key === editKey);
        const newValues = { ...newData[idx], ...values, status: 0 };
        newData.splice(idx, 1, newValues);
      } else {
        const newValues = { ...values, key: new Date().getTime(), status: 0 };
        newData.push(newValues);
      }

      localStorage.setItem(tabKey, JSON.stringify(newData));
      setData(newData);
      setIsModalVisible(false);
      message.success('方案保存成功');
    } catch (err) {
      console.log('方案保存失败:', err);
      message.error('方案保存失败');
    }
  }, [tabKey, data, editKey]);

  const handleCancel = useCallback(() => {
    setIsModalVisible(false);
  }, []);

  const handleDelete = useCallback(
    (record: any) => {
      try {
        const index = data.findIndex((item) => isSameScheme(item, record));
        if (index === -1) {
          message.info('当前方案不存在');
          return;
        }
        const newData = [...data];
        newData.splice(index, 1);
        localStorage.setItem(tabKey, JSON.stringify(newData));
        setData(newData);
        message.success('方案删除成功');
      } catch (err) {
        console.log('方案删除失败:', err);
        message.error('方案删除失败');
      }
    },
    [data, tabKey],
  );

  const handleTabChange = useCallback((key: string) => {
    setCurrent({});
    setTabKey(key);
  }, []);

  const handleSetIp = useCallback(
    async (record: any) => {
      try {
        isLoading.current = true;
        setCurrent({});

        const { address, netmask, gateway, dns, dns2 } = normalizeScheme(record);
        await netshSetAddress(
          current.tab,
          address,
          netmask,
          gateway || 'none',
          dns || 'none',
          dns2 || '',
        );

        const newData = data.map((d) => ({ ...d, status: +(d.key === record.key) }));
        localStorage.setItem(tabKey, JSON.stringify(newData));
        isLoading.current = false;
        setCurrent({});
        message.success('IP 方案设置成功');
      } catch (err) {
        console.log('IP 方案设置失败:', err);
        if (err.data) {
          notification.error({
            message: 'IP 方案设置失败',
            description: err.data.trim().split('\n').pop(),
            duration: 0,
          });
        } else {
          message.error('IP 方案设置失败');
        }
      }
    },
    [current, data, tabKey],
  );

  const handleSetDhcp = useCallback(async () => {
    try {
      isLoading.current = true;
      setCurrent({});

      await netshSetAddressDhcp(current.tab);

      const newData = data.map((d) => ({ ...d, status: 0 }));
      localStorage.setItem(tabKey, JSON.stringify(newData));
      message.success('自动获取设置成功');

      isLoading.current = false;
      setCurrent({});
    } catch (err) {
      console.log('自动获取设置失败:', err);
      if (err.data) {
        notification.error({
          message: '自动获取设置失败',
          description: err.data.trim().split('\n').pop(),
          duration: 0,
        });
      } else {
        message.error('自动获取设置失败');
      }
    }
  }, [current, data, tabKey]);

  const columns = [
    {
      title: 'IP 地址',
      dataIndex: 'address',
      key: 'address',
      ellipsis: true,
      render: (val) => val || '--',
    },
    {
      title: '子网掩码',
      dataIndex: 'netmask',
      key: 'netmask',
      ellipsis: true,
      render: (val) => val || '--',
    },
    {
      title: '网关地址',
      dataIndex: 'gateway',
      key: 'gateway',
      ellipsis: true,
      render: (val) => val || '--',
    },
    {
      title: 'DNS 地址',
      dataIndex: 'dns',
      key: 'dns',
      ellipsis: true,
      render: (val) => val || '--',
    },
    {
      title: '备用 DNS',
      dataIndex: 'dns2',
      key: 'dns2',
      ellipsis: true,
      render: (val) => val || '--',
    },
    {
      title: '备注信息',
      dataIndex: 'remark',
      key: 'remark',
      ellipsis: true,
      render: (val) => val || '--',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 68,
      render: (status: number) =>
        status === 0 ? <Tag color="red">已停用</Tag> : <Tag color="green">已启用</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      width: 152,
      render: (record: any) => (
        <>
          <Popconfirm
            title="确定要启用当前方案吗？"
            okText="确定"
            cancelText="取消"
            onConfirm={() => handleSetIp(record)}
            disabled={record.status !== 0 || !current.address}
          >
            <Button type="link" size="small" disabled={record.status !== 0 || !current.address}>
              启用
            </Button>
          </Popconfirm>
          <Button type="link" size="small" onClick={() => showModal(record)}>
            修改
          </Button>
          <Popconfirm
            placement="topRight"
            title="确定要删除当前方案吗？"
            okText="确定"
            cancelText="取消"
            onConfirm={() => handleDelete(record)}
          >
            <Button type="link" size="small">
              删除
            </Button>
          </Popconfirm>
        </>
      ),
    },
  ];

  useEffect(() => {
    checkEnv();
  }, []);

  useEffect(() => {
    setCurrent(tabList.find(({ key }) => key === tabKey) || {});
  }, [tabKey, tabList]);

  useEffect(() => {
    if (!current.address && !isLoading.current) {
      setTimeout(() => loadTabList(), 500);
    }
  }, [current]);

  useEffect(() => {
    if (tabKey) {
      loadData(tabKey);
    }
  }, [tabKey, current.address]);

  return (
    <ConfigProvider locale={zhCN}>
      {tabList.length ? (
        <Card
          className="container"
          bordered={false}
          tabList={tabList}
          activeTabKey={tabKey}
          onTabChange={handleTabChange}
          actions={[
            <Button type="link" size="small" key="add" onClick={() => showModal()}>
              <PlusOutlined style={{ marginRight: 8 }} />
              <span>新增方案</span>
            </Button>,
            <Popconfirm
              key="dhcp"
              title="确定要设置为【自动获取】吗？"
              okText="确定"
              cancelText="取消"
              onConfirm={handleSetDhcp}
              disabled={!current.address || current.dhcp}
            >
              <Button type="link" size="small" disabled={!current.address || current.dhcp}>
                <GlobalOutlined style={{ marginRight: 8 }} />
                <span>自动获取 (DHCP)</span>
              </Button>
            </Popconfirm>,
          ]}
        >
          <Alert
            message={alertMessage}
            style={{ marginBottom: 16 }}
            type="info"
            showIcon
            action={
              <a onClick={loadTabList}>
                <ReloadOutlined style={{ marginRight: 8 }} />
                <span>刷新</span>
              </a>
            }
          />
          <Table size="small" columns={columns} dataSource={data} />
        </Card>
      ) : (
        <div className="loading">
          <Spin size="large" tip="网卡信息获取中..." />
        </div>
      )}
      <Modal
        title="IP 配置方案"
        centered={true}
        visible={isModalVisible}
        onOk={handleOk}
        onCancel={handleCancel}
      >
        <Form form={form} labelCol={{ span: 5 }}>
          <Form.Item
            name="address"
            label="IP 地址"
            rules={[{ pattern: ipRegExp, message: '请输入正确的 IP 地址' }]}
          >
            <Input placeholder="请输入 IP 地址" />
          </Form.Item>
          <Form.Item
            name="netmask"
            label="子网掩码"
            rules={[{ pattern: ipRegExp, message: '请输入正确的子网掩码' }]}
          >
            <Input placeholder="请输入子网掩码" />
          </Form.Item>
          <Form.Item
            name="gateway"
            label="网关地址"
            rules={[{ pattern: ipRegExp, message: '请输入正确的网关地址' }]}
          >
            <Input placeholder="请输入网关地址" />
          </Form.Item>
          <Form.Item
            name="dns"
            label="DNS 地址"
            rules={[{ pattern: ipRegExp, message: '请输入正确的 DNS 地址' }]}
          >
            <Input placeholder="请输入 DNS 地址" />
          </Form.Item>
          <Form.Item
            name="dns2"
            label="备用 DNS"
            rules={[{ pattern: ipRegExp, message: '请输入正确的备用 DNS 地址' }]}
          >
            <Input placeholder="请输入备用 DNS 地址" />
          </Form.Item>
          <Form.Item
            name="remark"
            label="备注信息"
            rules={[{ type: 'string', max: 20, message: '备注信息最多可以输入 20 个字符' }]}
          >
            <Input placeholder="请输入备注信息" />
          </Form.Item>
        </Form>
      </Modal>
    </ConfigProvider>
  );
}
